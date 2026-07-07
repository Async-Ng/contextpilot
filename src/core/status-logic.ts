import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import {
  getStaleDecisionScopes,
  hasOpenDiscussion,
  listOpenDecisions,
  type Decision,
  type StaleDecisionScope,
} from "./decisions";
import { diffHashes, type HashEntry } from "./drift";
import { sha256File } from "./io";
import { getRuleFileDrift, listRules, type RuleFileDrift } from "./rules";
import { scanDiscoverItems } from "./discover";
import {
  getOrchestrationSummary,
  type OrchestrationSummary,
} from "./orchestration";
import { getSrsFileDrift, getSrsStatus, type SrsFileDrift, type SrsStatusReport } from "./srs-state";
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
  srsDrift: SrsFileDrift[];
  ruleDrift: RuleFileDrift[];
  staleDecisionScopes: StaleDecisionScope[];
}

export function computeStatus(harnessDir: string): StatusReport {
  const config = loadConfig(harnessDir);
  const state = loadState(harnessDir);
  const projectRoot = path.dirname(harnessDir);

  const missing: string[] = [];
  const known: Record<string, HashEntry> = {};
  const current: Record<string, string | undefined> = {};

  for (const [outputPath, entry] of Object.entries(state.generated)) {
    known[outputPath] = { hash: entry.hash, recordedAt: entry.writtenAt };
    if (!fs.existsSync(outputPath)) {
      missing.push(outputPath);
      continue;
    }
    current[outputPath] = sha256File(outputPath) ?? undefined;
  }

  const drift: StatusReport["drift"] = diffHashes(known, current)
    .filter((d) => d.kind === "stale")
    .map((d) => ({
      path: d.path,
      expectedHash: known[d.path]?.hash ?? "",
      actualHash: current[d.path] ?? "",
    }));

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
  const srsDrift = getSrsFileDrift(harnessDir);
  const ruleDrift = getRuleFileDrift(harnessDir, state);
  const staleDecisionScopes = getStaleDecisionScopes(harnessDir);

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
    srsDrift,
    ruleDrift,
    staleDecisionScopes,
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
