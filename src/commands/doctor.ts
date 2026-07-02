import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { loadConfig, resolveProjectPath } from "../core/config-io";
import { getGlobalOptions } from "../core/globals";
import { getHarnessDir, out, EXIT_OK } from "../core/io";
import { getOrchestrationSummary } from "../core/orchestration";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  status: "ok" | "warn" | "fail";
  initialized: boolean;
  harnessDir: string;
  checks: DoctorCheck[];
  orchestration?: ReturnType<typeof getOrchestrationSummary>;
}

function check(
  checks: DoctorCheck[],
  name: string,
  condition: boolean,
  passMessage: string,
  failMessage: string,
  failStatus: "warn" | "fail" = "warn",
): void {
  checks.push({
    name,
    status: condition ? "pass" : failStatus,
    message: condition ? passMessage : failMessage,
  });
}

function packageRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function computeOverall(checks: DoctorCheck[]): DoctorReport["status"] {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

function formatHuman(report: DoctorReport): string {
  const lines = [chalk.bold("contextpilot doctor:"), `ContextPilot: ${report.harnessDir}`];
  for (const item of report.checks) {
    const marker =
      item.status === "pass"
        ? chalk.green("PASS")
        : item.status === "warn"
          ? chalk.yellow("WARN")
          : chalk.red("FAIL");
    lines.push(`  ${marker} ${item.name}: ${item.message}`);
  }
  if (report.orchestration?.activeRun) {
    const run = report.orchestration.activeRun;
    const step = report.orchestration.activeStep;
    lines.push(`Active orchestration: ${run.id} (${step?.id ?? "no step"})`);
  }
  lines.push(`Overall: ${report.status}`);
  return lines.join("\n");
}

export function runDoctor(): void {
  const cwd = getGlobalOptions().cwd;
  const harnessDir = getHarnessDir(cwd);
  const configPath = path.join(harnessDir, "harness.config.json");
  const checks: DoctorCheck[] = [];
  const initialized = fs.existsSync(configPath);

  check(
    checks,
    "initialized",
    initialized,
    ".contextpilot config found",
    "Run `contextpilot setup` in this project",
    "warn",
  );

  const pkgRoot = packageRoot();
  check(
    checks,
    "package assets",
    fs.existsSync(path.join(pkgRoot, "assets", "skills", "fullstack-to-srs", "SKILL.md")),
    "bundled SRS skill assets found",
    "bundled SRS skill assets are missing",
    "fail",
  );

  let orchestration: DoctorReport["orchestration"];

  if (initialized) {
    const config = loadConfig(harnessDir);
    const projectRoot = path.dirname(harnessDir);

    for (const agent of config.agents) {
      const target = config.targets[agent];
      const targetPath = resolveProjectPath(harnessDir, target.output);
      const exists = agent === "cursor"
        ? fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
        : fs.existsSync(targetPath);
      check(
        checks,
        `generated ${agent}`,
        exists,
        `${target.output} exists`,
        `${target.output} is missing; run contextpilot sync`,
        "warn",
      );
    }

    const gitHook = path.join(projectRoot, ".git", "hooks", "pre-commit");
    check(
      checks,
      "git pre-commit",
      fs.existsSync(gitHook) && fs.readFileSync(gitHook, "utf8").includes("contextpilot gate precommit"),
      "contextpilot pre-commit backstop found",
      "git pre-commit backstop not found or project is not a git repo",
      "warn",
    );

    const claudeHooks = path.join(projectRoot, ".claude", "settings.json");
    const cursorHooks = path.join(projectRoot, ".cursor", "hooks.json");
    const codexHooks = path.join(projectRoot, ".codex", "hooks.json");
    check(
      checks,
      "agent hooks",
      fs.existsSync(claudeHooks) || fs.existsSync(cursorHooks) || fs.existsSync(codexHooks),
      "at least one agent hook config found",
      "no Claude/Cursor/Codex hook config found",
      "warn",
    );

    orchestration = getOrchestrationSummary(harnessDir);
  }

  const report: DoctorReport = {
    status: computeOverall(checks),
    initialized,
    harnessDir,
    checks,
    orchestration,
  };

  out(formatHuman(report), report);
  process.exit(EXIT_OK);
}
