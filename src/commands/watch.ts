import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import chalk from "chalk";
import { adoptExternalItems } from "../core/adopt";
import { type HarnessConfig } from "../core/config";
import { loadConfig, resolveProjectPath } from "../core/config-io";
import { hasOpenDiscussion } from "../core/decisions";
import { getDiscoverWatchPaths, getSkillWatchDirs, scanDiscoverItems } from "../core/discover";
import { evaluate, matchesGlob } from "../core/gate";
import { getGlobalOptions } from "../core/globals";
import { appendLine, EXIT_OK, out, requireHarness, sha256File } from "../core/io";
import { readActiveLearnings } from "../core/memory";
import { loadState } from "../core/state";
import { runSync } from "../core/sync";

const DEBOUNCE_MS = 300;
const REVERTED_FILE = "REVERTED.md";

function collectSensitiveScopePatterns(
  harnessDir: string,
  config: HarnessConfig,
): string[] {
  const patterns: string[] = [];
  for (const learning of readActiveLearnings(harnessDir)) {
    if (learning.sourceItemId) {
      patterns.push(...learning.scope);
    }
  }
  for (const globs of Object.values(config.srs.moduleMap)) {
    patterns.push(...globs);
  }
  return [...new Set(patterns)];
}

function getDiscussionScopePatterns(
  harnessDir: string,
  config: HarnessConfig,
): string[] {
  if (config.gate.mode === "strict") {
    return config.gate.businessScopes;
  }
  return collectSensitiveScopePatterns(harnessDir, config);
}

function scopePatternsToWatchDirs(
  projectRoot: string,
  patterns: string[],
): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const normalized = pattern.replace(/\\/g, "/");
    const globIdx = normalized.search(/[*?[]/);
    const prefix = globIdx === -1 ? normalized : normalized.slice(0, globIdx);
    const dir = prefix.replace(/\/$/, "");
    const abs = dir ? path.join(projectRoot, dir) : projectRoot;
    if (fs.existsSync(abs)) {
      dirs.add(abs);
    }
  }
  return [...dirs];
}

function isInDiscussionScope(
  filePath: string,
  projectRoot: string,
  scopePatterns: string[],
): boolean {
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (rel.startsWith("..")) {
    return false;
  }
  return matchesGlob(rel, scopePatterns);
}

function revertDeniedFile(
  harnessDir: string,
  projectRoot: string,
  filePath: string,
  reason: string,
): void {
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  try {
    execSync(`git checkout -- ${JSON.stringify(rel)}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    if (!getGlobalOptions().json) {
      console.warn(chalk.yellow(`[watch] git checkout failed for ${rel}`));
    }
    return;
  }

  const revertedPath = path.join(harnessDir, REVERTED_FILE);
  const timestamp = new Date().toISOString();
  appendLine(
    revertedPath,
    `## ${timestamp}\n- \`${rel}\` - ${reason}`,
  );

  if (!getGlobalOptions().json) {
    console.log(chalk.yellow(`[watch] reverted gated change: ${rel}`));
  }
}

export async function runWatch(): Promise<void> {
  const harnessDir = requireHarness();
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);

  const rulesDir = resolveProjectPath(harnessDir, config.rulesDir);
  const contextFile = resolveProjectPath(harnessDir, config.contextFile);
  const memoryFile = resolveProjectPath(harnessDir, config.memoryFile);
  const decisionsFile = resolveProjectPath(harnessDir, config.gate.decisionsFile);

  function getDiscussionWatchDirs(): string[] {
    if (!hasOpenDiscussion(harnessDir)) {
      return [];
    }
    const patterns = getDiscussionScopePatterns(harnessDir, config);
    return scopePatternsToWatchDirs(projectRoot, patterns);
  }

  const watchPaths = [
    rulesDir,
    contextFile,
    memoryFile,
    decisionsFile,
    ...getDiscoverWatchPaths(harnessDir),
    ...getSkillWatchDirs(harnessDir),
    ...getDiscussionWatchDirs(),
  ];

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let discussionScopePatterns: string[] = hasOpenDiscussion(harnessDir)
    ? getDiscussionScopePatterns(harnessDir, config)
    : [];
  const discussionWatchDirs = new Set(getDiscussionWatchDirs());

  function shouldIgnoreGenerated(filePath: string): boolean {
    const state = loadState(harnessDir);
    const normalized = path.normalize(filePath);
    const entry = state.generated[normalized];
    if (!entry) return false;
    const hash = sha256File(normalized);
    return hash === entry.hash;
  }

  function debounce(key: string, fn: () => void): void {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn();
      }, DEBOUNCE_MS),
    );
  }

  function syncDiscussionWatchers(watcher: FSWatcher): void {
    const active = hasOpenDiscussion(harnessDir);
    const nextPatterns = active ? getDiscussionScopePatterns(harnessDir, config) : [];
    const nextDirs = active ? scopePatternsToWatchDirs(projectRoot, nextPatterns) : [];

    for (const dir of discussionWatchDirs) {
      if (!nextDirs.includes(dir)) {
        void watcher.unwatch(dir);
        discussionWatchDirs.delete(dir);
      }
    }
    for (const dir of nextDirs) {
      if (!discussionWatchDirs.has(dir)) {
        void watcher.add(dir);
        discussionWatchDirs.add(dir);
      }
    }
    discussionScopePatterns = nextPatterns;
  }

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  function onChange(filePath: string, event: string): void {
    const normalizedDecisions = path.normalize(decisionsFile);
    if (path.normalize(filePath) === normalizedDecisions) {
      debounce("discussion:refresh", () => {
        syncDiscussionWatchers(watcher);
      });
      return;
    }

    if (shouldIgnoreGenerated(filePath)) return;

    if (
      discussionScopePatterns.length > 0 &&
      isInDiscussionScope(filePath, projectRoot, discussionScopePatterns)
    ) {
      const result = evaluate(harnessDir, { file: filePath });
      if (result.decision === "deny") {
        debounce(`revert:${filePath}`, () => {
          revertDeniedFile(harnessDir, projectRoot, filePath, result.reason);
        });
        return;
      }
    }

    const rel = path.relative(projectRoot, filePath);
    const isHarnessSource =
      rel.startsWith(".contextpilot/rules") ||
      rel === config.contextFile ||
      rel === config.memoryFile;

    if (isHarnessSource) {
      debounce(`sync:${filePath}`, () => {
        void runSync(harnessDir).then(() => {
          if (!getGlobalOptions().json) {
            console.log(chalk.dim(`[watch] synced after ${event}: ${rel}`));
          }
        });
      });
    } else {
      debounce(`refresh:${filePath}`, () => {
        void (async () => {
          const items = scanDiscoverItems(harnessDir);
          const match = items.find(
            (i) => path.normalize(i.path) === path.normalize(filePath),
          );
          if (match) {
            await adoptExternalItems(harnessDir, [match]);
          }
          await runSync(harnessDir, { allowDriftOverwrite: true });
          if (!getGlobalOptions().json) {
            console.log(chalk.dim(`[watch] auto-adopted/refreshed: ${rel}`));
          }
        })();
      });
    }
  }

  watcher.on("add", (filePath) => onChange(filePath, "add"));
  watcher.on("change", (filePath) => onChange(filePath, "change"));

  out(
    `Watching ${watchPaths.length} path(s). Press Ctrl+C to stop.`,
    {
      status: "watching",
      paths: watchPaths,
      inDiscussion: hasOpenDiscussion(harnessDir),
      discussionWatchDirs: [...discussionWatchDirs],
    },
  );

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void watcher.close().then(() => {
        for (const t of timers.values()) clearTimeout(t);
        out("Watch stopped.", { status: "stopped" });
        resolve();
        process.exit(EXIT_OK);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
