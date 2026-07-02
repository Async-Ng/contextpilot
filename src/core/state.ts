import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { writeAtomic } from "./io";
import { emptyState, harnessStateSchema, type HarnessState } from "./state-schema";

export function loadState(harnessDir: string): HarnessState {
  const config = loadConfig(harnessDir);
  const statePath = resolveProjectPath(harnessDir, config.stateFile);
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }
  const raw: unknown = JSON.parse(fs.readFileSync(statePath, "utf8"));
  return harnessStateSchema.parse(raw);
}

export function saveState(harnessDir: string, state: HarnessState): void {
  const config = loadConfig(harnessDir);
  const statePath = resolveProjectPath(harnessDir, config.stateFile);
  const validated = harnessStateSchema.parse(state);
  writeAtomic(statePath, `${JSON.stringify(validated, null, 2)}\n`);
}

export function getStateFilePath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  return resolveProjectPath(harnessDir, config.stateFile);
}

export { emptyState, type HarnessState };
