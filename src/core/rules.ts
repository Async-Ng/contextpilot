import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import type { HarnessConfig } from "./config";
import { loadConfig, resolveProjectPath } from "./config-io";
import { diffHashes, type HashEntry } from "./drift";
import { sha256, slugify, warn, writeAtomic } from "./io";
import {
  PRIORITY_ORDER,
  ruleFrontmatterSchema,
  type Priority,
  type Rule,
  type RuleFrontmatter,
} from "./rule-schema";
import { globHasMatches, type StaleScope } from "./scope-match";
import type { HarnessState } from "./state-schema";

export interface RuleFileDrift {
  path: string;
  kind: "stale";
}

function parseRuleFile(filePath: string, defaultTargets: string[]): Rule {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const fm = ruleFrontmatterSchema.parse(parsed.data);
  const baseName = path.basename(filePath, path.extname(filePath));
  const id = fm.id ?? baseName;
  return {
    filePath,
    id,
    title: fm.title ?? baseName,
    type: fm.type ?? "rule",
    scope: fm.scope ?? ["**/*"],
    targets: fm.targets ?? defaultTargets,
    priority: fm.priority ?? "normal",
    tags: fm.tags ?? [],
    origin: fm.origin,
    body: parsed.content.trim(),
  };
}

export function listRules(harnessDir: string): Rule[] {
  const config = loadConfig(harnessDir);
  const rulesDir = resolveProjectPath(harnessDir, config.rulesDir);
  if (!fs.existsSync(rulesDir)) {
    return [];
  }
  const files = fg.sync("**/*.md", { cwd: rulesDir, absolute: true });
  const rules = files.map((f) => parseRuleFile(f, config.agents));
  return sortRules(rules);
}

export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    return a.id.localeCompare(b.id);
  });
}

export function filterRulesForAgent(rules: Rule[], agent: string, dedupeGlobal: boolean): Rule[] {
  return rules.filter((rule) => {
    if (!rule.targets.includes(agent)) {
      return false;
    }
    if (
      dedupeGlobal &&
      rule.origin?.level === "global" &&
      rule.origin.agent === agent
    ) {
      return false;
    }
    return true;
  });
}

export function getRuleById(harnessDir: string, id: string): Rule | undefined {
  return listRules(harnessDir).find((r) => r.id === id);
}

export function writeRule(
  harnessDir: string,
  id: string,
  frontmatter: RuleFrontmatter,
  body: string,
  state?: HarnessState,
): string {
  const config = loadConfig(harnessDir);
  const rulesDir = resolveProjectPath(harnessDir, config.rulesDir);
  fs.mkdirSync(rulesDir, { recursive: true });
  const filePath = path.join(rulesDir, `${id}.md`);
  const data: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined) {
      data[key] = value;
    }
  }
  const content = matter.stringify(body, data);

  if (state) {
    const relPath = path.relative(path.dirname(harnessDir), filePath).replace(/\\/g, "/");
    const known = state.rules[relPath];
    if (known && fs.existsSync(filePath)) {
      const onDisk = fs.readFileSync(filePath, "utf8");
      if (sha256(onDisk) !== known.hash) {
        warn(`Overwriting hand-edited rule file: ${relPath}`);
      }
    }
    writeAtomic(filePath, content);
    state.rules[relPath] = { hash: sha256(content), writtenAt: new Date().toISOString() };
    return filePath;
  }

  writeAtomic(filePath, content);
  return filePath;
}

/**
 * Compares on-disk `.contextpilot/rules/*.md` files against the hashes
 * recorded the last time each was written, so a hand-edit that a subsequent
 * `srs ingest` is about to silently overwrite is visible beforehand.
 */
export function getRuleFileDrift(harnessDir: string, state: HarnessState): RuleFileDrift[] {
  const config = loadConfig(harnessDir);
  const rulesDir = resolveProjectPath(harnessDir, config.rulesDir);
  const projectRoot = path.dirname(harnessDir);

  const known: Record<string, HashEntry> = {};
  for (const [relPath, entry] of Object.entries(state.rules)) {
    known[relPath] = { hash: entry.hash, recordedAt: entry.writtenAt };
  }

  const current: Record<string, string | undefined> = {};
  if (fs.existsSync(rulesDir)) {
    for (const filePath of fg.sync("**/*.md", { cwd: rulesDir, absolute: true })) {
      const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
      current[relPath] = sha256(fs.readFileSync(filePath, "utf8"));
    }
  }

  // Only rule files this process has previously written (tracked in state.rules) can
  // meaningfully "drift" - rules written via other paths (add/adopt/scan/decision, which
  // don't pass `state`) are never tracked here, so treating them as "new" would be a false
  // positive, not a hand-edit warning.
  return diffHashes(known, current)
    .filter((d) => d.kind === "stale")
    .map((d) => ({ path: d.path, kind: "stale" as const }));
}

/**
 * Flags rule scope globs that match zero files on disk - the same staleness
 * check as `getStaleDecisionScopes`, applied to ingested rules. Rules tagged
 * `"removed"` (a module intentionally kept as a tombstone note - see
 * `srs.ts`'s removed-module detection) are excluded: a dead scope there is
 * expected, not a mistake.
 */
export function getStaleRuleScopes(harnessDir: string): StaleScope[] {
  const projectRoot = path.dirname(harnessDir);
  const stale: StaleScope[] = [];
  for (const rule of listRules(harnessDir)) {
    if (rule.tags.includes("removed")) continue;
    for (const scope of rule.scope) {
      if (!globHasMatches(projectRoot, scope)) {
        stale.push({ id: rule.id, scope });
      }
    }
  }
  return stale;
}

export function ruleIdFromPath(filePath: string): string {
  return slugify(path.basename(filePath, path.extname(filePath)));
}

export function defaultFrontmatter(
  config: HarnessConfig,
  overrides: Partial<RuleFrontmatter> = {},
): RuleFrontmatter {
  const baseName = overrides.title ?? "Imported Rule";
  return {
    id: overrides.id ?? slugify(baseName),
    title: overrides.title ?? baseName,
    type: overrides.type ?? "rule",
    scope: overrides.scope ?? ["**/*"],
    targets: overrides.targets ?? [...config.agents],
    priority: (overrides.priority ?? "normal") as Priority,
    tags: overrides.tags ?? [],
    origin: overrides.origin,
  };
}

export { type Rule };
