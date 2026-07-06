import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath, saveConfig } from "../core/config-io";
import { writeFocus } from "../core/context";
import { ingestSrs } from "../core/srs";
import { getSrsStatus, setSrsState } from "../core/srs-state";
import { runSync } from "../core/sync";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";
import {
  getActiveStep,
  getOrchestrationSummary,
  startRun,
} from "../core/orchestration";

function bundledSkillPath(): string {
  return path.join(__dirname, "..", "..", "assets", "skills", "fullstack-to-srs");
}

const CLAUDE_SKILL_PATH = ".claude/skills/fullstack-to-srs";

interface SkillInstallTarget {
  kind: "shared" | "claude";
  path: string;
}

interface SkillInstallResult {
  status: "installed" | "already_installed";
  sharedPath: string;
  claudePath: string | null;
  installed: string[];
  skipped: string[];
  synced: Awaited<ReturnType<typeof runSync>>;
}

interface SkillInstallCoreResult {
  status: "installed" | "already_installed";
  sharedPath: string;
  claudePath: string | null;
  installed: string[];
  skipped: string[];
}

function assertInstallableDestination(dest: string): void {
  if (!fs.existsSync(dest)) return;
  const skillFile = path.join(dest, "SKILL.md");
  if (fs.existsSync(skillFile)) return;
  throw new Error(`Existing skill destination is not a fullstack-to-srs skill: ${dest}`);
}

function installSkillTarget(src: string, dest: string): "installed" | "already_installed" {
  assertInstallableDestination(dest);
  if (fs.existsSync(dest)) {
    return "already_installed";
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return "installed";
}

function installSrsSkillTargets(harnessDir: string): SkillInstallCoreResult {
  const config = loadConfig(harnessDir);
  saveConfig(harnessDir, config);
  const src = bundledSkillPath();
  const sharedPath = resolveProjectPath(harnessDir, config.srs.skillPath);
  const claudePath = config.agents.includes("claude")
    ? resolveProjectPath(harnessDir, CLAUDE_SKILL_PATH)
    : null;
  const targets: SkillInstallTarget[] = [{ kind: "shared", path: sharedPath }];
  if (claudePath && claudePath !== sharedPath) {
    targets.push({ kind: "claude", path: claudePath });
  }

  const installed: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    const status = installSkillTarget(src, target.path);
    if (status === "installed") {
      installed.push(target.path);
    } else {
      skipped.push(target.path);
    }
  }

  return {
    status: installed.length > 0 ? "installed" : "already_installed",
    sharedPath,
    claudePath,
    installed,
    skipped,
  };
}

export async function runSrsInstall(): Promise<void> {
  const harnessDir = requireHarness();

  try {
    const skill = installSrsSkillTargets(harnessDir);
    const synced = await runSync(harnessDir);
    const result: SkillInstallResult = {
      ...skill,
      synced,
    };
    out(
      skill.installed.length > 0
        ? `Installed fullstack-to-srs skill to ${skill.installed.join(", ")}`
        : "fullstack-to-srs skill is already installed.",
      result,
    );
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errOut(`SRS skill install failed: ${message}`, {
      error: "srs_skill_install_failed",
      message,
    });
    process.exit(EXIT_GENERAL);
  }
}

function createBootstrapReadme(srsDir: string): { path: string; created: boolean } {
  const readmePath = path.join(srsDir, "README.md");
  fs.mkdirSync(srsDir, { recursive: true });
  if (fs.existsSync(readmePath)) {
    return { path: readmePath, created: false };
  }
  const content = [
    "# SRS",
    "",
    "This directory is reserved for the initial Software Requirements Specification.",
    "",
    "Use ContextPilot's bundled fullstack-to-srs skill:",
    "",
    "`.contextpilot/skills/fullstack-to-srs/SKILL.md`",
    "",
    "After writing the SRS, run:",
    "",
    "`contextpilot srs ingest --path docs/srs --reingest --json`",
    "",
  ].join("\n");
  fs.writeFileSync(readmePath, content, "utf8");
  return { path: readmePath, created: true };
}

export async function runSrsStatus(): Promise<void> {
  const harnessDir = requireHarness();
  const report = getSrsStatus(harnessDir);
  out(`SRS status: ${report.status} (${report.path})`, {
    status: "srs_status",
    srs: report,
  });
  process.exit(EXIT_OK);
}

export async function runSrsBootstrap(): Promise<void> {
  const harnessDir = requireHarness();
  const config = loadConfig(harnessDir);
  const srsPath = config.srs.bootstrapPath;
  const srsDir = resolveProjectPath(harnessDir, srsPath);

  try {
    const skill = installSrsSkillTargets(harnessDir);
    const readme = createBootstrapReadme(srsDir);
    writeFocus(
      harnessDir,
      `Build initial SRS in ${srsPath} using ${config.srs.skillPath}/SKILL.md.`,
    );

    let run = getOrchestrationSummary(harnessDir).activeRun;
    let orchestrationStatus: "started" | "already_active" = "already_active";
    if (!run) {
      run = await startRun(harnessDir, {
        goal: "Create initial SRS",
        scope: [`${srsPath.replace(/\\/g, "/")}/**`],
        workflow: "coding",
      });
      orchestrationStatus = "started";
    }

    const srs = await setSrsState(harnessDir, "bootstrapped", srsPath);
    const synced = await runSync(harnessDir);
    out("SRS bootstrap ready.", {
      status: "bootstrapped",
      srs,
      readme,
      skill,
      orchestration: {
        status: orchestrationStatus,
        run,
        activeStep: run ? getActiveStep(run) : undefined,
      },
      synced,
    });
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errOut(`SRS bootstrap failed: ${message}`, {
      error: "srs_bootstrap_failed",
      message,
      path: srsPath,
    });
    process.exit(EXIT_GENERAL);
  }
}

export async function runSrsIngest(options: {
  path?: string;
  reingest?: boolean;
}): Promise<void> {
  const harnessDir = requireHarness();
  const result = await ingestSrs(harnessDir, options.path, options.reingest ?? false);
  const synced = await runSync(harnessDir);
  out(
    `Ingested ${result.knowledgeUpserted} knowledge rule(s), seeded ${result.learningsSeeded} learning(s).`,
    { status: "ingested", ...result, synced },
  );
  process.exit(EXIT_OK);
}
