import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { getStateFilePath, loadState, saveState, type HarnessState } from "./state";
import type { SrsState, SrsStatus } from "./state-schema";
import { sha256, withLock } from "./io";
import { collectSrsSourceFiles } from "./srs-files";

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
    files: state.srs.files,
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

export interface SrsFileDrift {
  path: string;
  kind: "stale" | "new";
}

/**
 * Compares the current on-disk SRS source files against the hashes recorded
 * at last ingest, so stale/never-ingested files are visible without relying
 * on an agent remembering to re-run `srs ingest --reingest` after every edit.
 */
export function getSrsFileDrift(harnessDir: string): SrsFileDrift[] {
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const state = loadState(harnessDir);
  const srsPath = state.srs.path ?? config.srs.bootstrapPath;
  const srsDir = resolveProjectPath(harnessDir, srsPath);

  if (!fs.existsSync(srsDir)) return [];

  const drift: SrsFileDrift[] = [];
  const files = collectSrsSourceFiles(srsDir);
  for (const file of files) {
    const content = fs.readFileSync(file.fullPath, "utf8");
    const relPath = path.relative(projectRoot, file.fullPath).replace(/\\/g, "/");
    const known = state.srs.files[relPath];
    if (!known) {
      drift.push({ path: relPath, kind: "new" });
    } else if (known.hash !== sha256(content)) {
      drift.push({ path: relPath, kind: "stale" });
    }
  }
  return drift;
}
