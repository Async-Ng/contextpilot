import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { getStateFilePath, loadState, saveState, type HarnessState } from "./state";
import type { SrsState, SrsStatus } from "./state-schema";
import { withLock } from "./io";

export interface SrsStatusReport {
  status: SrsStatus | "unknown";
  path: string;
  updatedAt?: string;
  exists: boolean;
  skillInstalled: boolean;
  requiredForGreenfield: boolean;
  bootstrapMode: "nudge" | "strict";
}

function nowIso(): string {
  return new Date().toISOString();
}

export function setSrsStateOnState(
  state: HarnessState,
  status: SrsStatus,
  srsPath: string,
): void {
  state.srs = {
    status,
    path: srsPath.replace(/\\/g, "/"),
    updatedAt: nowIso(),
  };
}

export async function setSrsState(
  harnessDir: string,
  status: SrsStatus,
  srsPath?: string,
): Promise<SrsState> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => {
    const config = loadConfig(harnessDir);
    const state = loadState(harnessDir);
    setSrsStateOnState(state, status, srsPath ?? config.srs.bootstrapPath);
    saveState(harnessDir, state);
    return state.srs;
  });
}

export function getSrsStatus(harnessDir: string): SrsStatusReport {
  const config = loadConfig(harnessDir);
  const state = loadState(harnessDir);
  const srsPath = state.srs.path ?? config.srs.bootstrapPath;
  const srsDir = resolveProjectPath(harnessDir, srsPath);
  const skillPath = resolveProjectPath(harnessDir, config.srs.skillPath);
  return {
    status: state.srs.status ?? "unknown",
    path: srsPath.replace(/\\/g, "/"),
    updatedAt: state.srs.updatedAt,
    exists: fs.existsSync(srsDir),
    skillInstalled: fs.existsSync(path.join(skillPath, "SKILL.md")),
    requiredForGreenfield: config.srs.requiredForGreenfield,
    bootstrapMode: config.srs.bootstrapMode,
  };
}
