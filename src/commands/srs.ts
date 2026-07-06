import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath, saveConfig } from "../core/config-io";
import { ingestSrs } from "../core/srs";
import { runSync } from "../core/sync";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";

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

export async function runSrsInstall(): Promise<void> {
  const harnessDir = requireHarness();
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

  try {
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
    const synced = await runSync(harnessDir);
    const result: SkillInstallResult = {
      status: installed.length > 0 ? "installed" : "already_installed",
      sharedPath,
      claudePath,
      installed,
      skipped,
      synced,
    };
    out(
      installed.length > 0
        ? `Installed fullstack-to-srs skill to ${installed.join(", ")}`
        : "fullstack-to-srs skill is already installed.",
      result,
    );
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errOut(`SRS skill install failed: ${message}`, {
      error: "srs_skill_install_failed",
      message,
      sharedPath,
      claudePath,
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
