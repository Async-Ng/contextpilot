import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { hasOpenDiscussion, listOpenDecisions, type Decision } from "./decisions";
import { sha256File } from "./io";
import { listRules } from "./rules";
import { scanDiscoverItems } from "./discover";
import {
  getOrchestrationSummary,
  type OrchestrationSummary,
} from "./orchestration";
import { getSrsStatus, type SrsStatusReport } from "./srs-state";
import type { HarnessState } from "./state-schema";
import { loadState } from "./state";

function getLinkedRuleIds(state: HarnessState): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(state.generated)) {
    if (entry.sourceRuleId) {
      ids.add(entry.sourceRuleId);
    }
  }
  return ids;
}

export interface StatusReport {
  drift: Array<{ path: string; expectedHash: string; actualHash: string }>;
  missing: string[];
  newExternal: Array<{ path: string; agent: string; level: string; kind: string }>;
  newSkills: Array<{ name: string; path: string }>;
  pending: Array<{ id: string; title: string }>;
  inDiscussion: boolean;
  openDecisions: Decision[];
  orchestration: OrchestrationSummary;
  srs: SrsStatusReport;
}

export function computeStatus(harnessDir: string): StatusReport {
  const config = loadConfig(harnessDir);
  const state = loadState(harnessDir);
  const projectRoot = path.dirname(harnessDir);

  const drift: StatusReport["drift"] = [];
  const missing: string[] = [];

  for (const [outputPath, entry] of Object.entries(state.generated)) {
    if (!fs.existsSync(outputPath)) {
      missing.push(outputPath);
      continue;
    }
    const actualHash = sha256File(outputPath);
    if (actualHash && actualHash !== entry.hash) {
      drift.push({
        path: outputPath,
        expectedHash: entry.hash,
        actualHash,
      });
    }
  }

  const discoverItems = scanDiscoverItems(harnessDir);
  const newExternal = discoverItems
    .filter((i) => i.kind === "rule")
    .map((i) => ({
      path: i.path,
      agent: i.agent,
      level: i.level,
      kind: i.kind,
    }));

  const newSkills = discoverItems
    .filter((i) => i.kind === "skill")
    .map((i) => ({ name: i.name, path: i.path }));

  const linkedIds = getLinkedRuleIds(state);
  const rules = listRules(harnessDir);
  const pending = rules
    .filter((r) => !linkedIds.has(r.id))
    .map((r) => ({ id: r.id, title: r.title }));

  const openDecisions = listOpenDecisions(harnessDir);
  const inDiscussion = hasOpenDiscussion(harnessDir);
  const orchestration = getOrchestrationSummary(harnessDir);
  const srs = getSrsStatus(harnessDir);

  return {
    drift,
    missing,
    newExternal,
    newSkills,
    pending,
    inDiscussion,
    openDecisions,
    orchestration,
    srs,
  };
}

export function isHarnessGeneratedPath(
  filePath: string,
  state: HarnessState,
): boolean {
  const normalized = path.normalize(filePath);
  return Object.keys(state.generated).some(
    (p) => path.normalize(p) === normalized,
  );
}
