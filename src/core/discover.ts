import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fg from "fast-glob";
import type { HarnessConfig } from "./config";
import { loadConfig } from "./config-io";
import { warn } from "./io";
import { loadState } from "./state";

export type DiscoverLevel = "global" | "project";
export type DiscoverKind = "rule" | "skill";

export interface DiscoverItem {
  path: string;
  agent: string;
  level: DiscoverLevel;
  kind: DiscoverKind;
  name: string;
  preview: string;
  preSelected: boolean;
  readable: boolean;
}

const UNREADABLE_GLOBAL_AGENTS = new Set(["cursor", "copilot"]);

export function getDiscoverPaths(
  config: HarnessConfig,
  harnessDir: string,
  projectOnly?: boolean,
  globalOnly?: boolean,
): Array<{ agent: string; level: DiscoverLevel; patterns: string[] }> {
  const projectRoot = path.dirname(harnessDir);
  const home = os.homedir();
  const overrides = config.discover.paths;

  const defaults: Array<{ agent: string; level: DiscoverLevel; patterns: string[] }> = [
    { agent: "claude", level: "project", patterns: ["CLAUDE.md", "CLAUDE.local.md", "**/CLAUDE.md", ".claude/skills/**/SKILL.md", ".claude/agents/**"] },
    { agent: "claude", level: "global", patterns: [path.join(home, ".claude/CLAUDE.md"), path.join(home, ".claude/skills/**/SKILL.md"), path.join(home, ".claude/agents/**")] },
    { agent: "cursor", level: "project", patterns: [".cursor/rules/*.mdc", ".cursorrules"] },
    { agent: "cursor", level: "global", patterns: [] },
    { agent: "codex", level: "project", patterns: ["AGENTS.md", "**/AGENTS.md"] },
    { agent: "codex", level: "global", patterns: [path.join(home, ".codex/AGENTS.md")] },
    { agent: "windsurf", level: "project", patterns: [".windsurf/rules/*.md", ".windsurfrules"] },
    { agent: "windsurf", level: "global", patterns: [path.join(home, ".codeium/windsurf/memories/global_rules.md")] },
    { agent: "copilot", level: "project", patterns: [".github/copilot-instructions.md", ".github/instructions/*.instructions.md"] },
    { agent: "copilot", level: "global", patterns: [] },
  ];

  let paths = defaults.filter((p) => config.agents.includes(p.agent as never));

  if (projectOnly) {
    paths = paths.filter((p) => p.level === "project");
  }
  if (globalOnly) {
    paths = paths.filter((p) => p.level === "global");
  }

  if (Object.keys(overrides).length > 0) {
    const custom: typeof paths = [];
    for (const [key, value] of Object.entries(overrides)) {
      if (Array.isArray(value)) {
        const [agent, level] = key.split(":");
        if (agent && (level === "global" || level === "project")) {
          custom.push({ agent, level, patterns: value.map(String) });
        }
      }
    }
    if (custom.length > 0) {
      paths = custom;
    }
  }

  return paths.map((p) => ({
    ...p,
    patterns: p.patterns.map((pat) =>
      p.level === "project" ? path.join(projectRoot, pat) : pat,
    ),
  }));
}

function isSkillDir(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, "SKILL.md"));
}

function readPreview(filePath: string, maxLen = 500): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.slice(0, maxLen);
  } catch {
    return "";
  }
}

export function scanDiscoverItems(
  harnessDir: string,
  options: { projectOnly?: boolean; globalOnly?: boolean } = {},
): DiscoverItem[] {
  const config = loadConfig(harnessDir);
  const state = loadState(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const items: DiscoverItem[] = [];
  const seen = new Set<string>();
  const pathEntries = getDiscoverPaths(
    config,
    harnessDir,
    options.projectOnly,
    options.globalOnly,
  );

  for (const entry of pathEntries) {
    if (
      entry.level === "global" &&
      UNREADABLE_GLOBAL_AGENTS.has(entry.agent) &&
      entry.patterns.length === 0
    ) {
      warn(
        `${entry.agent} global rules live in app settings and cannot be auto-detected. Use \`contextpilot add\` manually.`,
      );
      continue;
    }

    for (const pattern of entry.patterns) {
      let matches: string[] = [];
      try {
        const isAbsolute = path.isAbsolute(pattern);
        matches = fg.sync(pattern, {
          absolute: true,
          onlyFiles: false,
          suppressErrors: true,
          cwd: isAbsolute ? undefined : projectRoot,
        });
      } catch {
        continue;
      }

      for (const match of matches) {
        if (!fs.existsSync(match)) continue;

        const stat = fs.statSync(match);
        if (stat.isDirectory()) {
          if (!isSkillDir(match)) continue;
          const normalized = path.normalize(match);
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          const skillName = path.basename(match);
          if (state.skills[skillName]) continue;
          items.push({
            path: normalized,
            agent: entry.agent,
            level: entry.level,
            kind: "skill",
            name: skillName,
            preview: readPreview(path.join(match, "SKILL.md")),
            preSelected: entry.level === "global",
            readable: true,
          });
          continue;
        }

        if (
          !match.endsWith(".md") &&
          !match.endsWith(".mdc") &&
          !match.endsWith(".instructions.md")
        ) {
          continue;
        }

        const normalized = path.normalize(match);
        if (seen.has(normalized)) continue;

        const relPath = path.relative(projectRoot, normalized);
        const adoptedKey = state.adopted[normalized] ?? state.adopted[relPath];
        if (adoptedKey) continue;

        const generatedPaths = new Set(Object.keys(state.generated));
        if (generatedPaths.has(normalized)) continue;

        seen.add(normalized);
        items.push({
          path: normalized,
          agent: entry.agent,
          level: entry.level,
          kind: "rule",
          name: path.basename(match, path.extname(match)),
          preview: readPreview(match),
          preSelected: entry.level === "global",
          readable: true,
        });
      }
    }
  }

  return items;
}

export function inferScope(
  level: DiscoverLevel,
  filePath: string,
  harnessDir: string,
): string[] {
  const projectRoot = path.dirname(harnessDir);
  if (level === "global") {
    return ["**/*"];
  }
  const rel = path.relative(projectRoot, filePath);
  const dir = path.dirname(rel);
  if (dir && dir !== ".") {
    return [`${dir}/**`];
  }
  return ["**/*"];
}

export function getSkillWatchDirs(harnessDir: string): string[] {
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const dirs = new Set<string>();
  dirs.add(path.join(projectRoot, config.srs.skillPath));
  dirs.add(path.join(projectRoot, ".claude/skills"));
  dirs.add(path.join(projectRoot, ".cursor/rules"));
  return [...dirs].filter((d) => fs.existsSync(d));
}

export function getDiscoverWatchPaths(harnessDir: string): string[] {
  const projectRoot = path.dirname(harnessDir);
  const paths = new Set<string>();
  paths.add(path.join(projectRoot, ".cursor/rules"));
  paths.add(path.join(projectRoot, ".github"));
  paths.add(path.join(projectRoot, ".windsurf"));
  return [...paths].filter((d) => fs.existsSync(d));
}
