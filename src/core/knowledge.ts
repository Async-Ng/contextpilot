import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "./config-io";
import { matchesGlob } from "./gate";
import { sha256, warn } from "./io";
import { resolveReadPolicy } from "./knowledge-policy";
import { listRules, sortRules, type Rule } from "./rules";
import { PRIORITY_ORDER } from "./rule-schema";
import { loadState } from "./state";

export type KnowledgeTask = "code" | "data" | "test" | "explore";

export interface KnowledgeQueryOptions {
  query?: string;
  files?: string[];
  scopes?: string[];
  target?: string;
  limit?: number;
  includeBody?: boolean;
  sections?: string[];
  modules?: string[];
  task?: KnowledgeTask;
  groupByModule?: boolean;
  preferCanonical?: boolean;
}

export interface KnowledgeResult {
  id: string;
  title: string;
  type: string;
  priority: string;
  scope: string[];
  targets: string[];
  tags: string[];
  score: number;
  reasons: string[];
  source: string;
  excerpt: string;
  section?: string;
  module?: string;
  canonicalSource?: string;
  readPolicy: string;
  deliveryHint: string;
  body?: string;
  resolvedFrom?: "canonical" | "rule";
}

export interface KnowledgeQueryResult {
  query: string | null;
  files: string[];
  scopes: string[];
  target: string | null;
  limit: number;
  task: KnowledgeTask | null;
  sections: string[];
  modules: string[];
  results: KnowledgeResult[];
}

const TASK_SECTION_PRIORITY: Record<KnowledgeTask, string[]> = {
  code: ["07", "03"],
  data: ["06", "07"],
  test: ["08", "11"],
  explore: ["03", "07"],
};

function projectRootFromHarness(harnessDir: string): string {
  return path.dirname(harnessDir);
}

function normalizeRelativePath(projectRoot: string, file: string): string {
  const normalized = file.replace(/\\/g, "/");
  if (path.isAbsolute(file)) {
    return path.relative(projectRoot, file).replace(/\\/g, "/");
  }
  return normalized;
}

function sourcePath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function excerpt(body: string, maxChars = 240): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function targetMatches(rule: Rule, target: string | undefined, configAgents: string[]): boolean {
  if (target) {
    return rule.targets.includes(target);
  }
  return rule.targets.some((ruleTarget) => configAgents.includes(ruleTarget));
}

function scoreText(rule: Rule, query: string | undefined, reasons: string[]): number {
  if (!query?.trim()) {
    return 0;
  }
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  let score = 0;
  const title = normalizeText(rule.title);
  const id = normalizeText(rule.id);
  const tags = rule.tags.map(normalizeText);
  const body = normalizeText(rule.body);
  const moduleName = normalizeText(rule.module ?? "");

  for (const token of queryTokens) {
    let matched = false;
    if (title.includes(token)) {
      score += 30;
      matched = true;
      reasons.push(`title:${token}`);
    }
    if (id.includes(token)) {
      score += 25;
      matched = true;
      reasons.push(`id:${token}`);
    }
    if (moduleName.includes(token)) {
      score += 22;
      matched = true;
      reasons.push(`module:${token}`);
    }
    if (tags.some((tag) => tag.includes(token))) {
      score += 20;
      matched = true;
      reasons.push(`tag:${token}`);
    }
    if (body.includes(token)) {
      score += 8;
      matched = true;
      reasons.push(`body:${token}`);
    }
    if (!matched) {
      score -= 2;
    }
  }

  return score;
}

function globHints(pattern: string): string[] {
  return pattern
    .replace(/\\/g, "/")
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length >= 2)
    .map((part) => part.toLowerCase());
}

function scopesOverlap(inputScope: string, ruleScopes: string[]): boolean {
  const normalized = inputScope.replace(/\\/g, "/");
  if (matchesGlob(normalized, ruleScopes)) {
    return true;
  }
  if (ruleScopes.includes(normalized)) {
    return true;
  }
  const inputHints = new Set(globHints(normalized));
  return ruleScopes.some((ruleScope) =>
    globHints(ruleScope).some((hint) => inputHints.has(hint)),
  );
}

function scoreScope(
  rule: Rule,
  files: string[],
  scopes: string[],
  projectRoot: string,
  reasons: string[],
): number {
  let score = 0;

  for (const file of files) {
    const rel = normalizeRelativePath(projectRoot, file);
    if (matchesGlob(rel, rule.scope)) {
      score += 80;
      reasons.push(`file:${rel}`);
    }
  }

  for (const scope of scopes) {
    if (scopesOverlap(scope, rule.scope)) {
      score += 60;
      reasons.push(`scope:${scope}`);
    }
  }

  return score;
}

function taskSectionBonus(rule: Rule, task: KnowledgeTask | undefined): number {
  if (!task || !rule.section) return 0;
  const priority = TASK_SECTION_PRIORITY[task];
  const index = priority.indexOf(rule.section);
  if (index < 0) return 0;
  return (priority.length - index) * 10;
}

function priorityBonus(rule: Rule): number {
  switch (rule.priority) {
    case "high":
      return 6;
    case "normal":
      return 3;
    case "low":
      return 0;
  }
}

function matchesSectionFilter(rule: Rule, sections: string[]): boolean {
  if (sections.length === 0) return true;
  if (!rule.section) return true;
  return sections.includes(rule.section);
}

function matchesModuleFilter(rule: Rule, modules: string[]): boolean {
  if (modules.length === 0) return true;
  if (!rule.module) return true;
  return modules.some(
    (m) => rule.module === m || rule.module?.includes(m) || m.includes(rule.module ?? ""),
  );
}

function groupResultsByModuleSection(results: KnowledgeResult[]): KnowledgeResult[] {
  const seen = new Set<string>();
  const grouped: KnowledgeResult[] = [];
  for (const result of results) {
    const key = `${result.section ?? "_"}:${result.module ?? result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grouped.push(result);
  }
  return grouped;
}

function applyReadPolicy(
  harnessDir: string,
  results: KnowledgeResult[],
  options: { files?: string[]; target?: string },
): KnowledgeResult[] {
  if (results.length === 0) {
    return results;
  }
  const config = loadConfig(harnessDir);
  const policy = resolveReadPolicy(
    options.target,
    options.files?.[0],
    results,
    { knowledgeMode: config.agentContext.knowledgeMode },
  );
  return results.map((result) => ({
    ...result,
    readPolicy: policy.policy,
    deliveryHint: policy.hint,
  }));
}

function toResult(
  rule: Rule,
  score: number,
  reasons: string[],
  projectRoot: string,
  includeBody: boolean,
  preferCanonical: boolean,
): KnowledgeResult {
  const ruleSource = sourcePath(projectRoot, rule.filePath);
  const canonical = rule.canonicalSource;
  const source =
    preferCanonical && canonical ? canonical.replace(/\\/g, "/") : ruleSource;

  return {
    id: rule.id,
    title: rule.title,
    type: rule.type,
    priority: rule.priority,
    scope: rule.scope,
    targets: rule.targets,
    tags: rule.tags,
    score,
    reasons: [...new Set(reasons)],
    source,
    excerpt: excerpt(rule.body),
    section: rule.section,
    module: rule.module,
    canonicalSource: canonical,
    readPolicy: "on-demand",
    deliveryHint: `Use \`contextpilot knowledge show ${rule.id}\` for full body`,
    ...(includeBody ? { body: rule.body } : {}),
  };
}

function resolveDefaultSections(
  options: KnowledgeQueryOptions,
  configSections: string[],
  isRelevantQuery: boolean,
): string[] {
  if (options.sections && options.sections.length > 0) {
    return options.sections;
  }
  if (!isRelevantQuery) {
    return [];
  }
  if (options.task) {
    return TASK_SECTION_PRIORITY[options.task];
  }
  return configSections;
}

export function queryKnowledge(
  harnessDir: string,
  options: KnowledgeQueryOptions = {},
): KnowledgeQueryResult {
  const config = loadConfig(harnessDir);
  const projectRoot = projectRootFromHarness(harnessDir);
  const files = (options.files ?? []).map((file) =>
    normalizeRelativePath(projectRoot, file),
  );
  const scopes = options.scopes ?? [];
  const isRelevantQuery = files.length > 0 || scopes.length > 0;
  const task = options.task ?? (isRelevantQuery ? "code" : undefined);
  const sections = resolveDefaultSections(
    options,
    config.agentContext.relevantDefaultSections,
    isRelevantQuery,
  );
  const modules = options.modules ?? [];
  const limit = options.limit ?? (isRelevantQuery ? config.agentContext.relevantDefaultLimit : 10);
  const groupByModule = options.groupByModule ?? (isRelevantQuery && config.agentContext.relevantGroupByModule);
  const preferCanonical = options.preferCanonical ?? true;

  const candidates = listRules(harnessDir).filter(
    (rule) =>
      rule.type === "knowledge" &&
      targetMatches(rule, options.target, config.agents) &&
      matchesSectionFilter(rule, sections) &&
      matchesModuleFilter(rule, modules),
  );

  let results = candidates
    .map((rule) => {
      const reasons: string[] = [];
      const matchScore =
        scoreScope(rule, files, scopes, projectRoot, reasons) +
        scoreText(rule, options.query, reasons) +
        taskSectionBonus(rule, task);
      const hasCriteria =
        Boolean(options.query?.trim()) || files.length > 0 || scopes.length > 0;
      const score = matchScore > 0 || !hasCriteria
        ? matchScore + priorityBonus(rule)
        : matchScore;
      return toResult(
        rule,
        score,
        reasons,
        projectRoot,
        options.includeBody ?? false,
        preferCanonical,
      );
    })
    .filter((result) => result.score > 0 || (!options.query && files.length === 0 && scopes.length === 0))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const priorityDiff =
        PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] -
        PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER];
      if (priorityDiff !== 0) return priorityDiff;
      return a.id.localeCompare(b.id);
    });

  if (groupByModule) {
    results = groupResultsByModuleSection(results);
  }

  const limited = results.slice(0, limit);

  return {
    query: options.query ?? null,
    files,
    scopes,
    target: options.target ?? null,
    limit,
    task: task ?? null,
    sections,
    modules,
    results: applyReadPolicy(harnessDir, limited, {
      files,
      target: options.target,
    }),
  };
}

function canonicalHashMatches(
  harnessDir: string,
  canonicalPath: string,
): boolean {
  const state = loadState(harnessDir);
  const normalized = canonicalPath.replace(/\\/g, "/");
  const entry = state.srs.files?.[normalized];
  if (!entry) return false;
  const projectRoot = projectRootFromHarness(harnessDir);
  const fullPath = path.join(projectRoot, normalized);
  if (!fs.existsSync(fullPath)) return false;
  const onDisk = fs.readFileSync(fullPath, "utf8");
  return sha256(onDisk) === entry.hash;
}

export interface KnowledgeShowResult extends KnowledgeResult {
  resolvedFrom: "canonical" | "rule";
  driftWarning?: string;
}

export function getKnowledgeById(
  harnessDir: string,
  id: string,
): KnowledgeShowResult | null {
  const projectRoot = projectRootFromHarness(harnessDir);
  const rule = sortRules(listRules(harnessDir)).find(
    (candidate) => candidate.type === "knowledge" && candidate.id === id,
  );
  if (!rule) {
    return null;
  }

  let body = rule.body;
  let resolvedFrom: "canonical" | "rule" = "rule";
  let driftWarning: string | undefined;

  if (rule.canonicalSource) {
    const canonicalPath = path.join(projectRoot, rule.canonicalSource);
    if (fs.existsSync(canonicalPath)) {
      if (canonicalHashMatches(harnessDir, rule.canonicalSource)) {
        body = fs.readFileSync(canonicalPath, "utf8").trim();
        resolvedFrom = "canonical";
      } else {
        const message =
          `Canonical source drift for ${id}: ${rule.canonicalSource} hash does not match ingested SRS state; using rule body.`;
        warn(message);
        driftWarning = message;
      }
    }
  }

  const base = toResult(rule, 0, ["id"], projectRoot, true, resolvedFrom === "canonical");
  return {
    ...base,
    body,
    source:
      resolvedFrom === "canonical"
        ? rule.canonicalSource!.replace(/\\/g, "/")
        : base.source,
    resolvedFrom,
    ...(driftWarning ? { driftWarning } : {}),
  };
}
