import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import type { HarnessConfig } from "./config";
import { loadConfig, resolveProjectPath } from "./config-io";
import { slugify, writeAtomic } from "./io";
import {
  PRIORITY_ORDER,
  ruleFrontmatterSchema,
  type Priority,
  type Rule,
  type RuleFrontmatter,
} from "./rule-schema";

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
  writeAtomic(filePath, content);
  return filePath;
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
