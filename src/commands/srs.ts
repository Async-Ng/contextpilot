import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, resolveProjectPath } from "../core/config-io";
import { ingestSrs } from "../core/srs";
import {
  EXIT_OK,
  exitRequiresHuman,
  isInteractive,
  out,
  requireHarness,
} from "../core/io";

function bundledSkillPath(): string {
  return path.join(__dirname, "..", "..", "assets", "skills", "fullstack-to-srs");
}

export async function runSrsInstall(): Promise<void> {
  if (!isInteractive()) {
    exitRequiresHuman("srs install");
  }

  const harnessDir = requireHarness();
  const config = loadConfig(harnessDir);
  const dest = resolveProjectPath(harnessDir, config.srs.skillPath);
  const src = bundledSkillPath();

  p.intro(chalk.bold("Install fullstack-to-srs skill"));
  p.log.warn(
    "Optimized for Claude Code (subagent orchestration). Cursor/Codex only run the single-agent fallback.",
  );

  if (fs.existsSync(dest)) {
    const overwrite = await p.confirm({
      message: `${dest} exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Install cancelled.");
      process.exit(EXIT_OK);
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });

  out(`Installed skill to ${dest}`, { status: "installed", path: dest });
  p.outro(chalk.green("Skill installed."));
  process.exit(EXIT_OK);
}

export async function runSrsIngest(options: {
  path?: string;
  reingest?: boolean;
}): Promise<void> {
  const harnessDir = requireHarness();
  const result = await ingestSrs(harnessDir, options.path, options.reingest ?? false);
  out(
    `Ingested ${result.knowledgeUpserted} knowledge rule(s), seeded ${result.learningsSeeded} learning(s).`,
    { status: "ingested", ...result },
  );
  process.exit(EXIT_OK);
}
