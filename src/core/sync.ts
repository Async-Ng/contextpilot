import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentName, HarnessConfig } from "./config";
import { loadConfig, resolveProjectPath } from "./config-io";
import { readFocus } from "./context";
import { sha256, sha256File, warn, withLock, writeAtomic } from "./io";
import { formatLearningsSection, readActiveLearnings } from "./memory";
import { HARNESS_PROTOCOL } from "./protocol";
import { filterRulesForAgent, listRules, sortRules, type Rule } from "./rules";
import { getStateFilePath, loadState, saveState, type HarnessState } from "./state";

export interface SyncOptions {
  target?: string;
  dryRun?: boolean;
  allowDriftOverwrite?: boolean;
}

export interface SyncResult {
  written: string[];
  skipped: string[];
  warnings: string[];
}

function buildSingleFileContent(
  config: HarnessConfig,
  harnessDir: string,
  agent: AgentName,
): string {
  const rules = filterRulesForAgent(
    sortRules(listRules(harnessDir)),
    agent,
    config.dedupeGlobal,
  );
  const ruleRules = rules.filter((r) => r.type === "rule");
  const knowledgeRules = rules.filter((r) => r.type === "knowledge");
  const focus = readFocus(harnessDir);
  const learnings = readActiveLearnings(harnessDir);
  const learningsText = formatLearningsSection(
    learnings,
    config.maxLearningsPerFile,
  );

  const sections: string[] = [config.header];

  if (ruleRules.length > 0) {
    sections.push("# Project Rules", "");
    for (const r of ruleRules) {
      sections.push(`## ${r.title}`, "", r.body, "");
    }
  }

  if (knowledgeRules.length > 0) {
    sections.push("# Project Knowledge", "");
    for (const r of knowledgeRules) {
      sections.push(`## ${r.title}`, "", r.body, "");
    }
  }

  if (focus) {
    sections.push("# Current Focus", "", focus, "");
  }

  if (learningsText) {
    sections.push(
      "# Learned Constraints â€” DO NOT repeat these mistakes",
      "",
      learningsText,
      "",
    );
  }

  sections.push("# ContextPilot Protocol", "", HARNESS_PROTOCOL, "");
  return sections.join("\n");
}

function mdcFrontmatter(
  description: string,
  globs: string[],
  alwaysApply: boolean,
): string {
  const lines = [
    "---",
    `description: "${description.replace(/"/g, '\\"')}"`,
    `globs: ${JSON.stringify(globs)}`,
    `alwaysApply: ${alwaysApply}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function buildCursorFiles(
  config: HarnessConfig,
  harnessDir: string,
): Map<string, string> {
  const files = new Map<string, string>();
  const rules = filterRulesForAgent(
    sortRules(listRules(harnessDir)),
    "cursor",
    config.dedupeGlobal,
  );
  const ruleRules = rules.filter((r) => r.type === "rule");
  const globalKnowledge = rules.filter(
    (r) => r.type === "knowledge" && r.scope.includes("**/*"),
  );
  const scopedKnowledge = rules.filter(
    (r) => r.type === "knowledge" && !r.scope.includes("**/*"),
  );
  const focus = readFocus(harnessDir);
  const learnings = readActiveLearnings(harnessDir);
  const learningsText = formatLearningsSection(
    learnings,
    config.maxLearningsPerFile,
  );

  const projectParts: string[] = [];
  for (const r of ruleRules) {
    projectParts.push(`## ${r.title}`, "", r.body, "");
  }
  for (const r of globalKnowledge) {
    projectParts.push(`## ${r.title}`, "", r.body, "");
  }
  if (projectParts.length > 0) {
    files.set(
      "_project.mdc",
      mdcFrontmatter("Project rules and global knowledge", ["**/*"], true) +
        projectParts.join("\n"),
    );
  }

  for (const r of scopedKnowledge) {
    files.set(
      `${r.id}.mdc`,
      mdcFrontmatter(r.title, r.scope, false) + `${r.body}\n`,
    );
  }

  if (learningsText) {
    files.set(
      "_learnings.mdc",
      mdcFrontmatter("Learned constraints", ["**/*"], true) +
        `# Learned Constraints â€” DO NOT repeat these mistakes\n\n${learningsText}\n`,
    );
  }

  if (focus) {
    files.set(
      "_focus.mdc",
      mdcFrontmatter("Current focus", ["**/*"], true) +
        `# Current Focus\n\n${focus}\n`,
    );
  }

  files.set(
    "_contextpilot.mdc",
    mdcFrontmatter("ContextPilot protocol", ["**/*"], true) +
      `# ContextPilot Protocol\n\n${HARNESS_PROTOCOL}\n`,
  );

  return files;
}

function checkDrift(
  state: HarnessState,
  outputPath: string,
  warnings: string[],
): boolean {
  const entry = state.generated[outputPath];
  if (!entry) return false;
  const currentHash = sha256File(outputPath);
  if (currentHash && currentHash !== entry.hash) {
    warnings.push(`Drift detected at ${outputPath} (manual edits)`);
    return true;
  }
  return false;
}

function writeOutput(
  outputPath: string,
  content: string,
  state: HarnessState,
  sourceRuleId: string | undefined,
  dryRun: boolean,
): void {
  if (dryRun) return;
  writeAtomic(outputPath, content);
  state.generated[outputPath] = {
    hash: sha256(content),
    writtenAt: new Date().toISOString(),
    sourceRuleId,
  };
}

function cleanupStaleCursorFiles(
  outputDir: string,
  currentFiles: Set<string>,
  state: HarnessState,
  dryRun: boolean,
): void {
  if (!fs.existsSync(outputDir)) return;
  const existing = fs.readdirSync(outputDir).filter((f) => f.endsWith(".mdc"));
  for (const file of existing) {
    const fullPath = path.join(outputDir, file);
    if (!currentFiles.has(file)) {
      if (!dryRun) {
        fs.unlinkSync(fullPath);
        delete state.generated[fullPath];
      }
    }
  }
}

export async function runSync(
  harnessDir: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const config = loadConfig(harnessDir);
  const statePath = getStateFilePath(harnessDir);
  const agents = options.target
    ? config.agents.filter((a) => a === options.target)
  : config.agents;

  if (options.target && agents.length === 0) {
    throw new Error(`Unknown or disabled target: ${options.target}`);
  }

  return withLock(statePath, () => {
    const state = loadState(harnessDir);
    const written: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    const dryRun = options.dryRun ?? false;
    const allowDrift = options.allowDriftOverwrite ?? true;

    for (const agent of agents) {
      const target = config.targets[agent];
      const outputRel = target.output;
      const projectRoot = path.dirname(harnessDir);

      if (agent === "cursor") {
        const outputDir = path.join(projectRoot, outputRel);
        const cursorFiles = buildCursorFiles(config, harnessDir);
        cleanupStaleCursorFiles(
          outputDir,
          new Set(cursorFiles.keys()),
          state,
          dryRun,
        );
        for (const [filename, content] of cursorFiles) {
          const fullPath = path.join(outputDir, filename);
          const hasDrift = checkDrift(state, fullPath, warnings);
          if (hasDrift && !allowDrift) {
            skipped.push(fullPath);
            continue;
          }
          if (hasDrift) {
            warn(`Overwriting drifted file: ${fullPath}`);
          }
          writeOutput(fullPath, content, state, undefined, dryRun);
          written.push(fullPath);
        }
      } else {
        const fullPath = path.join(projectRoot, outputRel);
        const hasDrift = checkDrift(state, fullPath, warnings);
        if (hasDrift && !allowDrift) {
          skipped.push(fullPath);
          continue;
        }
        if (hasDrift) {
          warn(`Overwriting drifted file: ${fullPath}`);
        }
        const content = buildSingleFileContent(config, harnessDir, agent);
        writeOutput(fullPath, content, state, undefined, dryRun);
        written.push(fullPath);
      }
    }

    const rules = listRules(harnessDir);
    for (const rule of rules) {
      for (const agent of agents) {
        if (!rule.targets.includes(agent)) continue;
        const target = config.targets[agent as AgentName];
        if (agent === "cursor" && rule.type === "knowledge") {
          const fullPath = path.join(
            path.dirname(harnessDir),
            target.output,
            `${rule.id}.mdc`,
          );
          if (state.generated[fullPath]) {
            state.generated[fullPath] = {
              ...state.generated[fullPath],
              sourceRuleId: rule.id,
            };
          }
        }
      }
    }

    if (!dryRun) {
      saveState(harnessDir, state);
    }

    return { written, skipped, warnings };
  });
}

export { type Rule };
