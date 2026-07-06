import * as path from "node:path";
import { loadConfig } from "./config-io";
import { matchesGlob } from "./gate";
import { listRules, sortRules, type Rule } from "./rules";
import { PRIORITY_ORDER } from "./rule-schema";

export interface KnowledgeQueryOptions {
  query?: string;
  files?: string[];
  scopes?: string[];
  target?: string;
  limit?: number;
  includeBody?: boolean;
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
  body?: string;
}

export interface KnowledgeQueryResult {
  query: string | null;
  files: string[];
  scopes: string[];
  target: string | null;
  limit: number;
  results: KnowledgeResult[];
}

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

function toResult(
  rule: Rule,
  score: number,
  reasons: string[],
  projectRoot: string,
  includeBody: boolean,
): KnowledgeResult {
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
    source: sourcePath(projectRoot, rule.filePath),
    excerpt: excerpt(rule.body),
    ...(includeBody ? { body: rule.body } : {}),
  };
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
  const limit = options.limit ?? 10;
  const candidates = listRules(harnessDir).filter(
    (rule) =>
      rule.type === "knowledge" &&
      targetMatches(rule, options.target, config.agents),
  );

  const results = candidates
    .map((rule) => {
      const reasons: string[] = [];
      const matchScore =
        scoreScope(rule, files, scopes, projectRoot, reasons) +
        scoreText(rule, options.query, reasons);
      const hasCriteria =
        Boolean(options.query?.trim()) || files.length > 0 || scopes.length > 0;
      const score = matchScore > 0 || !hasCriteria
        ? matchScore + priorityBonus(rule)
        : matchScore;
      return toResult(rule, score, reasons, projectRoot, options.includeBody ?? false);
    })
    .filter((result) => result.score > 0 || (!options.query && files.length === 0 && scopes.length === 0))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const priorityDiff =
        PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] -
        PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER];
      if (priorityDiff !== 0) return priorityDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);

  return {
    query: options.query ?? null,
    files,
    scopes,
    target: options.target ?? null,
    limit,
    results,
  };
}

export function getKnowledgeById(
  harnessDir: string,
  id: string,
): KnowledgeResult | null {
  const projectRoot = projectRootFromHarness(harnessDir);
  const rule = sortRules(listRules(harnessDir)).find(
    (candidate) => candidate.type === "knowledge" && candidate.id === id,
  );
  if (!rule) {
    return null;
  }
  return toResult(rule, 0, ["id"], projectRoot, true);
}
