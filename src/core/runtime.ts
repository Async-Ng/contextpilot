import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { sha256, writeAtomic } from "./io";
import { loadState, saveState } from "./state";

interface RuntimeState {
  orchestration?: {
    activeRunId?: string;
  };
}

function projectRoot(harnessDir: string): string {
  return path.dirname(harnessDir);
}

function externalRuntimeBase(harnessDir: string): string {
  const root = projectRoot(harnessDir);
  return path.join(os.homedir(), ".contextpilot", "runtime", sha256(root).slice(0, 16));
}

export function getRuntimeDir(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  if (config.runtime.mode === "external") {
    return config.runtime.dir
      ? path.resolve(projectRoot(harnessDir), config.runtime.dir)
      : externalRuntimeBase(harnessDir);
  }
  return resolveProjectPath(harnessDir, config.runtime.dir ?? ".contextpilot/runtime");
}

export function isRuntimeExternalized(harnessDir: string): boolean {
  return loadConfig(harnessDir).runtime.mode !== "legacy";
}

export function getRuntimeStateFilePath(harnessDir: string): string {
  return path.join(getRuntimeDir(harnessDir), "state.json");
}

export function getOrchestrationRunsFilePath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  if (config.runtime.mode === "legacy") {
    return resolveProjectPath(harnessDir, config.orchestration.runsFile);
  }
  return path.join(getRuntimeDir(harnessDir), "orchestration", "runs.jsonl");
}

export function getOrchestrationEventsFilePath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  if (config.runtime.mode === "legacy") {
    return resolveProjectPath(harnessDir, config.orchestration.eventsFile);
  }
  return path.join(getRuntimeDir(harnessDir), "orchestration", "events.jsonl");
}

function readRuntimeState(harnessDir: string): RuntimeState {
  const statePath = getRuntimeStateFilePath(harnessDir);
  if (!fs.existsSync(statePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as RuntimeState;
}

function writeRuntimeState(harnessDir: string, state: RuntimeState): void {
  writeAtomic(getRuntimeStateFilePath(harnessDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function getRuntimeActiveRunId(harnessDir: string): string | undefined {
  const durableState = loadState(harnessDir);
  if (!isRuntimeExternalized(harnessDir)) {
    return durableState.orchestration.activeRunId;
  }
  return readRuntimeState(harnessDir).orchestration?.activeRunId
    ?? durableState.orchestration.activeRunId;
}

export function setRuntimeActiveRunId(
  harnessDir: string,
  activeRunId: string | undefined,
): void {
  if (!isRuntimeExternalized(harnessDir)) {
    const durableState = loadState(harnessDir);
    durableState.orchestration.activeRunId = activeRunId;
    saveState(harnessDir, durableState);
    return;
  }
  const runtimeState = readRuntimeState(harnessDir);
  runtimeState.orchestration = {
    ...runtimeState.orchestration,
    activeRunId,
  };
  writeRuntimeState(harnessDir, runtimeState);
}
