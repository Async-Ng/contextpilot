import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentName, HarnessConfig } from "./config";
import { loadConfig, resolveProjectPath } from "./config-io";
import { readFocus } from "./context";
import { sha256, sha256File, warn, withLock, writeAtomic } from "./io";
import { formatLearningsSection, readActiveLearnings } from "./memory";
import { buildGlobalKnowledgeSummary } from "./knowledge-summary";
import { STANDARD_HARNESS_PROTOCOL, STUB_HARNESS_PROTOCOL } from "./protocol";
import { filterRulesForAgent, listRules, sortRules, type Rule } from "./rules";
import { getSrsStatus } from "./srs-state";
import { getStateFilePath, loadState, saveState, type HarnessState } from "./state";

export interface SyncOptions {
  target?: string;
  dryRun?: boolean;
  allowDriftOverwrite?: boolean;
}

export interface SyncResult {
  written: string[];
  unchanged: string[];
  skipped: string[];
  warnings: string[];
  sizeSummary: {
    changedFiles: number;
    currentBytes: number;
    nextBytes: number;
    deltaBytes: number;
  };
}

function protocolForConfig(config: HarnessConfig): string {
  return config.agentContext.protocolLevel === "stub"
    ? STUB_HARNESS_PROTOCOL
    : STANDARD_HARNESS_PROTOCOL;
}

function projectRelativePath(projectRoot: string, fullPath: string): string {
  return path.relative(projectRoot, fullPath).replace(/\\/g, "/");
}

function normalizeExcerpt(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function buildKnowledgeIndexContent(
  config: HarnessConfig,
  projectRoot: string,
  knowledgeRules: Rule[],
): string {
  const lines: string[] = [
    config.header,
    "# ContextPilot Knowledge Index",
    "",
    "Use this index to choose which local knowledge files to read for the current task. Read the full source file before relying on a knowledge item.",
    "",
  ];

  for (const rule of knowledgeRules) {
    lines.push(
      `## ${rule.title}`,
      "",
      `- ID: ${rule.id}`,
      `- Section: ${rule.section ?? "-"}`,
      `- Module: ${rule.module ?? "-"}`,
      `- Priority: ${rule.priority}`,
      `- Scope: ${formatList(rule.scope)}`,
      `- Targets: ${formatList(rule.targets)}`,
      `- Source: ${projectRelativePath(projectRoot, rule.filePath)}`,
    );
    if (rule.canonicalSource) {
      lines.push(`- Canonical: ${rule.canonicalSource}`);
    }
    const excerpt = normalizeExcerpt(
      rule.body,
      config.agentContext.knowledgeExcerptChars,
    );
    if (excerpt) {
      lines.push(`- Excerpt: ${excerpt}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function appendKnowledgeSection(
  sections: string[],
  config: HarnessConfig,
  projectRoot: string,
  knowledgeRules: Rule[],
  globalKnowledge: Rule[],
): void {
  if (knowledgeRules.length === 0 && globalKnowledge.length === 0) {
    return;
  }

  if (config.agentContext.knowledgeMode === "inline") {
    sections.push("# Project Knowledge", "");
    for (const r of knowledgeRules) {
      sections.push(`## ${r.title}`, "", r.body, "");
    }
    return;
  }

  const indexRel = config.agentContext.knowledgeIndexFile.replace(/\\/g, "/");
  const listMode = config.agentContext.listKnowledgeInMainFile;

  if (listMode === "none") {
    sections.push(
      "# Project Knowledge",
      "",
      `Knowledge index: \`${indexRel}\`.`,
      "Use `contextpilot knowledge relevant --file \"<path>\" --task code --limit 2 --json` then `knowledge show <id>`.",
      "",
    );
  } else if (listMode === "compact") {
    sections.push(
      "# Project Knowledge",
      "",
      `Knowledge index: \`${indexRel}\`.`,
      "Agent files contain SRS summaries only. For file-scoped work:",
      "`contextpilot knowledge relevant --file \"<path>\" --task code --limit 2 --json`",
      "Load full body: `contextpilot knowledge show <id>` (max 1-2 per task).",
      "",
    );
  } else {
    sections.push(
      "# Project Knowledge Index",
      "",
      `Full project knowledge is indexed at \`${indexRel}\`.`,
      "Before relying on SRS, requirements, or imported knowledge, read the relevant source files listed in that index for the current task scope.",
      "",
    );
    for (const r of knowledgeRules) {
      const canonical = r.canonicalSource ? ` - canonical: ${r.canonicalSource}` : "";
      sections.push(
        `- ${r.title} (${r.id}) - scope: ${formatList(r.scope)} - source: ${projectRelativePath(projectRoot, r.filePath)}${canonical}`,
      );
    }
    sections.push("");
  }

  if (
    config.agentContext.globalKnowledgePolicy === "summary" &&
    globalKnowledge.length > 0
  ) {
    const summary = buildGlobalKnowledgeSummary(config, globalKnowledge);
    if (summary) {
      sections.push(summary, "");
    }
  } else if (config.agentContext.globalKnowledgePolicy === "full") {
    for (const r of globalKnowledge) {
      sections.push(`## ${r.title}`, "", r.body, "");
    }
  } else if (
    config.agentContext.globalKnowledgePolicy === "index-only" &&
    globalKnowledge.length > 0
  ) {
    const indexRel = config.agentContext.knowledgeIndexFile.replace(/\\/g, "/");
    sections.push(
      "## Global SRS Knowledge",
      "",
      `Global SRS sections are indexed in \`${indexRel}\`.`,
      "Use `contextpilot knowledge relevant --file \"<path>\" --task code --limit 2 --json` then `knowledge show <id>`.",
      "",
    );
  }
}

function buildSrsBootstrapSection(
  config: HarnessConfig,
  harnessDir: string,
): string | null {
  const srs = getSrsStatus(harnessDir);
  if (
    !config.srs.requiredForGreenfield ||
    (srs.status !== "missing" && srs.status !== "bootstrapped")
  ) {
    return null;
  }

  const srsPath = srs.path || config.srs.bootstrapPath;
  const skillPath = config.srs.skillPath.replace(/\\/g, "/");
  return [
    "# SRS Bootstrap Required",
    "",
    "This greenfield project does not have an ingested SRS yet.",
    `Before feature or business coding, run \`contextpilot srs bootstrap --json\` if SRS is not bootstrapped yet.`,
    `Use \`${skillPath}/SKILL.md\` to create the initial SRS under \`${srsPath}\`.`,
    `After writing the SRS, run \`contextpilot srs ingest --path ${srsPath} --reingest --json\`.`,
    "Nudge mode warns only. Strict mode may block business edits until bootstrap is started.",
    "",
  ].join("\n");
}

function buildSingleFileContent(
  config: HarnessConfig,
  harnessDir: string,
  agent: AgentName,
  allRules: Rule[],
): string {
  const rules = filterRulesForAgent(
    sortRules(allRules),
    agent,
    config.dedupeGlobal,
  );
  const projectRoot = path.dirname(harnessDir);
  const ruleRules = rules.filter((r) => r.type === "rule");
  const knowledgeRules = rules.filter((r) => r.type === "knowledge");
  const globalKnowledge = knowledgeRules.filter((r) => r.scope.includes("**/*"));
  const focus = readFocus(harnessDir);
  const learnings = readActiveLearnings(harnessDir);
  const learningsText = formatLearningsSection(
    learnings,
    config.maxLearningsPerFile,
  );

  const sections: string[] = [config.header];
  const srsBootstrapSection = buildSrsBootstrapSection(config, harnessDir);
  if (srsBootstrapSection) {
    sections.push(srsBootstrapSection);
  }

  if (ruleRules.length > 0) {
    sections.push("# Project Rules", "");
    for (const r of ruleRules) {
      sections.push(`## ${r.title}`, "", r.body, "");
    }
  }

  appendKnowledgeSection(sections, config, projectRoot, knowledgeRules, globalKnowledge);

  if (focus) {
    sections.push("# Current Focus", "", focus, "");
  }

  if (learningsText) {
    sections.push(
      "# Learned Constraints - DO NOT repeat these mistakes",
      "",
      learningsText,
      "",
    );
  }

  sections.push("# ContextPilot Protocol", "", protocolForConfig(config), "");
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
  allRules: Rule[],
): Map<string, string> {
  const files = new Map<string, string>();
  const rules = filterRulesForAgent(
    sortRules(allRules),
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
  const srsBootstrapSection = buildSrsBootstrapSection(config, harnessDir);

  if (srsBootstrapSection) {
    files.set(
      "_srs_bootstrap.mdc",
      mdcFrontmatter("SRS bootstrap required", ["**/*"], true) +
        `${srsBootstrapSection}\n`,
    );
  }

  const projectParts: string[] = [];
  for (const r of ruleRules) {
    projectParts.push(`## ${r.title}`, "", r.body, "");
  }
  if (config.agentContext.globalKnowledgePolicy === "summary" && globalKnowledge.length > 0) {
    const summary = buildGlobalKnowledgeSummary(config, globalKnowledge);
    if (summary) {
      projectParts.push(summary, "");
    }
  } else if (config.agentContext.globalKnowledgePolicy === "full") {
    for (const r of globalKnowledge) {
      projectParts.push(`## ${r.title}`, "", r.body, "");
    }
  } else if (
    config.agentContext.globalKnowledgePolicy === "index-only" &&
    globalKnowledge.length > 0
  ) {
    const indexRel = config.agentContext.knowledgeIndexFile.replace(/\\/g, "/");
    projectParts.push(
      "## Global SRS Knowledge",
      "",
      `Global SRS sections are indexed in \`${indexRel}\`.`,
      "Use `contextpilot knowledge relevant --file \"<path>\" --task code --limit 2 --json` then `knowledge show <id>`.",
      "",
    );
  }
  if (projectParts.length > 0) {
    files.set(
      "_project.mdc",
      mdcFrontmatter("Project rules and global knowledge", ["**/*"], true) +
        projectParts.join("\n"),
    );
  }

  if (globalKnowledge.length > 0 && config.agentContext.globalKnowledgePolicy !== "full") {
    const fullGlobal = globalKnowledge.map((r) => `## ${r.title}\n\n${r.body}`).join("\n\n");
    files.set(
      "_srs-global.mdc",
      mdcFrontmatter("Global SRS (on-demand)", ["docs/srs/**"], false) + `${fullGlobal}\n`,
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
        `# Learned Constraints - DO NOT repeat these mistakes\n\n${learningsText}\n`,
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
      `# ContextPilot Protocol\n\n${protocolForConfig(config)}\n`,
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
): "written" | "unchanged" {
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : undefined;
  if (existing === content) {
    if (!dryRun && state.generated[outputPath]) {
      state.generated[outputPath] = {
        ...state.generated[outputPath],
        sourceRuleId,
      };
    }
    return "unchanged";
  }
  if (dryRun) return "written";
  writeAtomic(outputPath, content);
  state.generated[outputPath] = {
    hash: sha256(content),
    writtenAt: new Date().toISOString(),
    sourceRuleId,
  };
  return "written";
}

function measureSizeChange(
  outputPath: string,
  content: string,
  summary: SyncResult["sizeSummary"],
): void {
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (existing === content) {
    return;
  }
  summary.changedFiles++;
  summary.currentBytes += Buffer.byteLength(existing, "utf8");
  summary.nextBytes += Buffer.byteLength(content, "utf8");
  summary.deltaBytes = summary.nextBytes - summary.currentBytes;
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

function cleanupStaleKnowledgeIndex(
  outputPath: string,
  state: HarnessState,
  dryRun: boolean,
): void {
  if (!state.generated[outputPath]) {
    return;
  }
  if (!dryRun && fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  if (!dryRun) {
    delete state.generated[outputPath];
  }
}

function warnIfMainFileTooLarge(
  outputPath: string,
  content: string,
  maxChars: number,
  warnings: string[],
): void {
  if (content.length <= maxChars) {
    return;
  }
  warnings.push(
    `Generated main agent file exceeds maxMainFileChars at ${outputPath}: ${content.length}/${maxChars} chars`,
  );
}

function filterKnowledgeRulesForIndex(
  rules: Rule[],
  agents: AgentName[],
  dedupeGlobal: boolean,
): Rule[] {
  const byId = new Map<string, Rule>();
  for (const agent of agents) {
    if (agent === "cursor") {
      continue;
    }
    for (const rule of filterRulesForAgent(sortRules(rules), agent, dedupeGlobal)) {
      if (rule.type === "knowledge") {
        byId.set(rule.id, rule);
      }
    }
  }
  return sortRules([...byId.values()]);
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
    const unchanged: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    const sizeSummary: SyncResult["sizeSummary"] = {
      changedFiles: 0,
      currentBytes: 0,
      nextBytes: 0,
      deltaBytes: 0,
    };
    const dryRun = options.dryRun ?? false;
    const allowDrift = options.allowDriftOverwrite ?? true;
    const projectRoot = path.dirname(harnessDir);
    const rules = listRules(harnessDir);
    const knowledgeRules = filterKnowledgeRulesForIndex(
      rules,
      agents,
      config.dedupeGlobal,
    );
    const knowledgeIndexPath = resolveProjectPath(
      harnessDir,
      config.agentContext.knowledgeIndexFile,
    );
    const shouldWriteKnowledgeIndex =
      knowledgeRules.length > 0 &&
      config.agentContext.knowledgeMode === "manifest" &&
      agents.some((agent) => agent !== "cursor");

    if (shouldWriteKnowledgeIndex) {
      const content = buildKnowledgeIndexContent(
        config,
        projectRoot,
        knowledgeRules,
      );
      const hasDrift = checkDrift(state, knowledgeIndexPath, warnings);
      if (hasDrift && !allowDrift) {
        skipped.push(knowledgeIndexPath);
      } else {
        if (hasDrift) {
          warn(`Overwriting drifted file: ${knowledgeIndexPath}`);
        }
        measureSizeChange(knowledgeIndexPath, content, sizeSummary);
        const action = writeOutput(knowledgeIndexPath, content, state, undefined, dryRun);
        (action === "written" ? written : unchanged).push(knowledgeIndexPath);
      }
    } else {
      cleanupStaleKnowledgeIndex(knowledgeIndexPath, state, dryRun);
    }

    for (const agent of agents) {
      const target = config.targets[agent];
      const outputRel = target.output;

      if (agent === "cursor") {
        const outputDir = path.join(projectRoot, outputRel);
        const cursorFiles = buildCursorFiles(config, harnessDir, rules);
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
          measureSizeChange(fullPath, content, sizeSummary);
          const action = writeOutput(fullPath, content, state, undefined, dryRun);
          (action === "written" ? written : unchanged).push(fullPath);
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
        const content = buildSingleFileContent(config, harnessDir, agent, rules);
        warnIfMainFileTooLarge(
          fullPath,
          content,
          config.agentContext.maxMainFileChars,
          warnings,
        );
        measureSizeChange(fullPath, content, sizeSummary);
        const action = writeOutput(fullPath, content, state, undefined, dryRun);
        (action === "written" ? written : unchanged).push(fullPath);
      }
    }

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

    return { written, unchanged, skipped, warnings, sizeSummary };
  });
}

export { type Rule };
