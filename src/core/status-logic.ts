import * as fs from "node:fs";
import * as path from "node:path";
import { resolvedCommandWithSubcommand, resolveContextPilotCommand } from "./command-resolution";
import { loadConfig } from "./config-io";
import {
  getStaleDecisionScopes,
  hasOpenDiscussion,
  listOpenDecisions,
  type Decision,
  type StaleDecisionScope,
} from "./decisions";
import { diffHashes, type HashEntry } from "./drift";
import { sha256File } from "./io";
import { getRuleFileDrift, getStaleRuleScopes, listRules, type RuleFileDrift } from "./rules";
import type { StaleScope } from "./scope-match";
import { scanDiscoverItems } from "./discover";
import { getOrchestrationSummary, type OrchestrationSummary } from "./orchestration";
import { getSrsFileDrift, getSrsStatus, type SrsFileDrift, type SrsStatusReport } from "./srs-state";
import type { HarnessState } from "./state-schema";
import { loadState } from "./state";

export type StatusMode = "full" | "fast";

export interface StatusSectionDiagnostic {
  stage: string;
  elapsedMs: number;
  status: "ok" | "warning" | "error" | "skipped";
  reason?: string;
  suggestedCommand?: string;
}

export interface StatusWarning {
  stage: string;
  reason: string;
  suggestedCommand?: string;
}

export interface StatusDiagnostics {
  mode: StatusMode;
  partial: boolean;
  sections: StatusSectionDiagnostic[];
  warnings: StatusWarning[];
}

export interface StatusGeneratedSummary {
  trackedCount: number;
  missingCount: number;
  driftCount: number;
}

export interface StatusReport {
  mode: StatusMode;
  drift: Array<{ path: string; expectedHash: string; actualHash: string }>;
  missing: string[];
  newExternal: Array<{ path: string; agent: string; level: string; kind: string }>;
  newSkills: Array<{ name: string; path: string }>;
  pending: Array<{ id: string; title: string }>;
  inDiscussion: boolean;
  openDecisions: Decision[];
  orchestration: OrchestrationSummary;
  srs: SrsStatusReport | null;
  srsDrift: SrsFileDrift[];
  ruleDrift: RuleFileDrift[];
  staleDecisionScopes: StaleDecisionScope[];
  staleRuleScopes: StaleScope[];
  diagnostics: StatusDiagnostics;
  generated: StatusGeneratedSummary;
  resolvedCommand: string;
}

export interface StatusOptions {
  fast?: boolean;
}

function getLinkedRuleIds(state: HarnessState): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(state.generated)) {
    if (entry.sourceRuleId) {
      ids.add(entry.sourceRuleId);
    }
  }
  return ids;
}

function buildEmptyReport(mode: StatusMode, projectRoot: string): StatusReport {
  return {
    mode,
    drift: [],
    missing: [],
    newExternal: [],
    newSkills: [],
    pending: [],
    inDiscussion: false,
    openDecisions: [],
    orchestration: { enabled: false, blocked: false },
    srs: null,
    srsDrift: [],
    ruleDrift: [],
    staleDecisionScopes: [],
    staleRuleScopes: [],
    diagnostics: {
      mode,
      partial: false,
      sections: [],
      warnings: [],
    },
    generated: {
      trackedCount: 0,
      missingCount: 0,
      driftCount: 0,
    },
    resolvedCommand: resolveContextPilotCommand(projectRoot).command,
  };
}

function timedSection<T>(
  report: StatusReport,
  stage: string,
  fn: () => T,
  options: { suggestedCommand?: string; skip?: boolean } = {},
): T | undefined {
  if (options.skip) {
    report.diagnostics.sections.push({
      stage,
      elapsedMs: 0,
      status: "skipped",
      reason: `Skipped in ${report.mode} mode.`,
      suggestedCommand: options.suggestedCommand,
    });
    return undefined;
  }

  const started = Date.now();
  try {
    const result = fn();
    report.diagnostics.sections.push({
      stage,
      elapsedMs: Date.now() - started,
      status: "ok",
      suggestedCommand: options.suggestedCommand,
    });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    report.diagnostics.partial = true;
    report.diagnostics.sections.push({
      stage,
      elapsedMs: Date.now() - started,
      status: "error",
      reason,
      suggestedCommand: options.suggestedCommand,
    });
    report.diagnostics.warnings.push({
      stage,
      reason,
      suggestedCommand: options.suggestedCommand,
    });
    return undefined;
  }
}

function computeGeneratedState(
  harnessDir: string,
  state: HarnessState,
): Pick<StatusReport, "drift" | "missing" | "generated"> {
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

  const drift = diffHashes(known, current)
    .filter((d) => d.kind === "stale")
    .map((d) => ({
      path: d.path,
      expectedHash: known[d.path]?.hash ?? "",
      actualHash: current[d.path] ?? "",
    }));

  return {
    drift,
    missing,
    generated: {
      trackedCount: Object.keys(state.generated).length,
      missingCount: missing.length,
      driftCount: drift.length,
    },
  };
}

export function computeStatus(harnessDir: string, options: StatusOptions = {}): StatusReport {
  const mode: StatusMode = options.fast ? "fast" : "full";
  const projectRoot = path.dirname(harnessDir);
  const report = buildEmptyReport(mode, projectRoot);
  const state = loadState(harnessDir);

  timedSection(report, "generated drift scan", () => {
    const generated = computeGeneratedState(harnessDir, state);
    report.drift = generated.drift;
    report.missing = generated.missing;
    report.generated = generated.generated;
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "sync --preview").invocation,
  });

  timedSection(report, "decision load", () => {
    report.openDecisions = listOpenDecisions(harnessDir);
    report.inDiscussion = hasOpenDiscussion(harnessDir);
    report.staleDecisionScopes = getStaleDecisionScopes(harnessDir);
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "doctor").invocation,
  });

  timedSection(report, "orchestration load", () => {
    report.orchestration = getOrchestrationSummary(harnessDir);
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "orchestrate status --json").invocation,
  });

  timedSection(report, "srs state load", () => {
    report.srs = getSrsStatus(harnessDir);
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "doctor").invocation,
  });

  timedSection(report, "discover scan", () => {
    const discoverItems = scanDiscoverItems(harnessDir);
    report.newExternal = discoverItems
      .filter((i) => i.kind === "rule")
      .map((i) => ({
        path: i.path,
        agent: i.agent,
        level: i.level,
        kind: i.kind,
      }));
    report.newSkills = discoverItems
      .filter((i) => i.kind === "skill")
      .map((i) => ({ name: i.name, path: i.path }));
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "status --fast").invocation,
    skip: mode === "fast",
  });

  timedSection(report, "rule registry load", () => {
    const linkedIds = getLinkedRuleIds(state);
    const rules = listRules(harnessDir);
    report.pending = rules
      .filter((r) => !linkedIds.has(r.id))
      .map((r) => ({ id: r.id, title: r.title }));
    report.staleRuleScopes = getStaleRuleScopes(harnessDir);
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "status --fast").invocation,
    skip: mode === "fast",
  });

  timedSection(report, "srs drift scan", () => {
    report.srsDrift = getSrsFileDrift(harnessDir);
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "status --fast").invocation,
    skip: mode === "fast",
  });

  timedSection(report, "rule drift scan", () => {
    report.ruleDrift = getRuleFileDrift(harnessDir, state);
  }, {
    suggestedCommand: resolvedCommandWithSubcommand(projectRoot, "status --fast").invocation,
    skip: mode === "fast",
  });

  return report;
}

export function hasStatusIssues(report: StatusReport): boolean {
  return (
    report.drift.length > 0 ||
    report.missing.length > 0 ||
    report.newExternal.length > 0 ||
    report.newSkills.length > 0 ||
    report.pending.length > 0 ||
    report.inDiscussion ||
    report.srsDrift.length > 0 ||
    report.ruleDrift.length > 0 ||
    report.staleDecisionScopes.length > 0 ||
    report.staleRuleScopes.length > 0 ||
    report.diagnostics.partial
  );
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

export function getStatusActionHint(report: StatusReport, projectRoot: string): string {
  if (report.diagnostics.partial) {
    return resolvedCommandWithSubcommand(projectRoot, "status --fast").invocation;
  }
  if (report.drift.length > 0 || report.missing.length > 0) {
    return resolvedCommandWithSubcommand(projectRoot, "sync --preview").invocation;
  }
  if (report.srs?.requiredForGreenfield && report.srs.status === "missing") {
    return resolvedCommandWithSubcommand(projectRoot, "srs bootstrap --json").invocation;
  }
  if (report.srs?.status === "bootstrapped" || report.srsDrift.length > 0) {
    return resolvedCommandWithSubcommand(
      projectRoot,
      `srs ingest --path ${report.srs?.path ?? "docs/srs"} --reingest --json`,
    ).invocation;
  }
  if (report.orchestration.activeRun) {
    return resolvedCommandWithSubcommand(projectRoot, "orchestrate status --json").invocation;
  }
  return resolvedCommandWithSubcommand(projectRoot, "doctor").invocation;
}

export function getStatusConfidenceSummary(report: StatusReport): string {
  const parts: string[] = [];
  if (report.srs) {
    const usable = report.srs.status === "ingested" ? "usable" : report.srs.status;
    parts.push(`SRS ${usable}`);
  }
  parts.push(
    report.generated.missingCount + report.generated.driftCount > 0
      ? `${report.generated.missingCount + report.generated.driftCount} generated issue(s)`
      : "generated files in sync",
  );
  parts.push(
    report.orchestration.activeRun ? "orchestration active" : "orchestration idle",
  );
  if (report.diagnostics.partial) {
    parts.push("diagnostics partial");
  }
  return parts.join(", ");
}
