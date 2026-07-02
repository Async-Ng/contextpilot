import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import fg from "fast-glob";
import { loadConfig } from "../core/config-io";
import { defaultFrontmatter, writeRule } from "../core/rules";
import {
  EXIT_OK,
  exitRequiresHuman,
  isInteractive,
  out,
  requireHarness,
  slugify,
} from "../core/io";
import { runSync } from "../core/sync";

export async function runAdd(targetPath: string): Promise<void> {
  if (!isInteractive()) {
    exitRequiresHuman("add");
  }

  const harnessDir = requireHarness();
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const resolved = path.resolve(projectRoot, targetPath);

  if (!fs.existsSync(resolved)) {
    out(`Path not found: ${resolved}`, { error: "not_found", path: resolved });
    process.exit(1);
  }

  p.intro(chalk.bold(`Add rule from ${targetPath}`));

  const files: string[] = [];
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    files.push(
      ...fg.sync("**/*.md", {
        cwd: resolved,
        absolute: true,
        deep: config.scan.maxDepth,
      }),
    );
  } else {
    files.push(resolved);
  }

  if (files.length === 0) {
    p.log.warn("No .md files found.");
    process.exit(EXIT_OK);
  }

  const typeChoice = await p.select({
    message: "Default rule type",
    options: [
      { value: "rule", label: "rule" },
      { value: "knowledge", label: "knowledge" },
    ],
    initialValue: "rule",
  });
  if (p.isCancel(typeChoice)) {
    p.cancel("Add cancelled.");
    process.exit(EXIT_OK);
  }

  const imported: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const baseName = path.basename(file, ".md");
    const id = slugify(baseName);
    const fm = defaultFrontmatter(config, {
      id,
      title: baseName,
      type: typeChoice as "rule" | "knowledge",
    });
    writeRule(harnessDir, id, fm, content);
    imported.push(id);
  }

  const syncConfirm = await p.confirm({
    message: "Sync now?",
    initialValue: true,
  });
  if (!p.isCancel(syncConfirm) && syncConfirm) {
    await runSync(harnessDir);
  }

  out(`Added ${imported.length} rule(s): ${imported.join(", ")}`, {
    status: "added",
    rules: imported,
  });
  p.outro(chalk.green("Done."));
  process.exit(EXIT_OK);
}
