import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import { loadConfig, resolveProjectPath } from "./config-io";
import { sha256, slugify } from "./io";
import type { DiscoverItem } from "./discover";
import { inferScope } from "./discover";
import { defaultFrontmatter, writeRule } from "./rules";
import { getStateFilePath, loadState, saveState } from "./state";
import { withLock } from "./io";

export function adoptRuleItem(
  harnessDir: string,
  item: DiscoverItem,
  overrides: {
    type?: "rule" | "knowledge";
    scope?: string[];
    targets?: string[];
    priority?: "high" | "normal" | "low";
  } = {},
): string {
  const config = loadConfig(harnessDir);
  const content = fs.readFileSync(item.path, "utf8");
  let body = content;
  let existingFm: Record<string, unknown> = {};

  if (item.path.endsWith(".md") || item.path.endsWith(".mdc")) {
    const parsed = matter(content);
    body = parsed.content.trim();
    existingFm = parsed.data as Record<string, unknown>;
  }

  const id = slugify(
    typeof existingFm.id === "string" ? existingFm.id : item.name,
  );
  const fm = defaultFrontmatter(config, {
    id,
    title:
      typeof existingFm.title === "string" ? existingFm.title : item.name,
    type: overrides.type ?? "knowledge",
    scope: overrides.scope ?? inferScope(item.level, item.path, harnessDir),
    targets: overrides.targets,
    priority: overrides.priority ?? "normal",
    origin: { agent: item.agent, level: item.level },
  });

  writeRule(harnessDir, id, fm, body);
  return id;
}

export async function adoptExternalItems(
  harnessDir: string,
  items: DiscoverItem[],
): Promise<{ adopted: string[]; skillsSeen: string[] }> {
  const statePath = getStateFilePath(harnessDir);
  const adopted: string[] = [];
  const skillsSeen: string[] = [];

  return withLock(statePath, () => {
    const state = loadState(harnessDir);
    const projectRoot = path.dirname(harnessDir);

    for (const item of items) {
      if (item.kind === "skill") {
        const hash = sha256(fs.readFileSync(path.join(item.path, "SKILL.md"), "utf8"));
        state.skills[item.name] = { level: item.level, hash };
        skillsSeen.push(item.name);
        continue;
      }

      const ruleId = adoptRuleItem(harnessDir, item, { type: "knowledge" });
      const relPath = path.relative(projectRoot, item.path);
      state.adopted[item.path] = ruleId;
      state.adopted[relPath] = ruleId;
      adopted.push(ruleId);
    }

    saveState(harnessDir, state);
    return { adopted, skillsSeen };
  });
}

export async function pinGlobalSkill(
  harnessDir: string,
  skillPath: string,
  destRelative: string,
): Promise<void> {
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const dest = resolveProjectPath(harnessDir, destRelative);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(skillPath, dest, { recursive: true });
}
