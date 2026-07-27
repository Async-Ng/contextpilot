import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { writeAtomic } from "./io";
import { emptyState, harnessStateSchema, type HarnessState } from "./state-schema";

function projectRoot(harnessDir: string): string {
  return path.dirname(harnessDir);
}

export function toStatePathKey(harnessDir: string, filePath: string): string {
  const root = projectRoot(harnessDir);
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const rel = path.relative(root, absolute).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel
    : filePath.replace(/\\/g, "/");
}

export function resolveStatePathKey(harnessDir: string, key: string): string {
  if (path.isAbsolute(key)) {
    return key;
  }
  return path.join(projectRoot(harnessDir), key);
}

function normalizePathRecord<T>(
  harnessDir: string,
  record: Record<string, T>,
): Record<string, T> {
  const normalized: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[toStatePathKey(harnessDir, key)] = value;
  }
  return normalized;
}

function normalizeStatePaths(harnessDir: string, state: HarnessState): HarnessState {
  return {
    ...state,
    generated: normalizePathRecord(harnessDir, state.generated),
    rules: normalizePathRecord(harnessDir, state.rules),
  };
}

export function loadState(harnessDir: string): HarnessState {
  const config = loadConfig(harnessDir);
  const statePath = resolveProjectPath(harnessDir, config.stateFile);
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }
  const raw: unknown = JSON.parse(fs.readFileSync(statePath, "utf8"));
  return normalizeStatePaths(harnessDir, harnessStateSchema.parse(raw));
}

export function saveState(harnessDir: string, state: HarnessState): void {
  const config = loadConfig(harnessDir);
  const statePath = resolveProjectPath(harnessDir, config.stateFile);
  const validated = harnessStateSchema.parse(normalizeStatePaths(harnessDir, state));
  writeAtomic(statePath, `${JSON.stringify(validated, null, 2)}\n`);
}

export function getStateFilePath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  return resolveProjectPath(harnessDir, config.stateFile);
}

export { emptyState, type HarnessState };
