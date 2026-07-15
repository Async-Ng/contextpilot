import type { AgentName } from "../core/config";
import { loadConfig } from "../core/config-io";
import { readFocus } from "../core/context";
import { listOpenDecisions, type Decision } from "../core/decisions";
import { EXIT_OK, out, requireHarness } from "../core/io";
import { queryKnowledge } from "../core/knowledge";
import { resolveReadPolicy } from "../core/knowledge-policy";
import {
  formatLearningsSection,
  readActiveLearnings,
  sortLearnings,
  type Learning,
} from "../core/memory";
import {
  getOrchestrationSummary,
  type OrchestrationSummary,
} from "../core/orchestration";
import { autoIngestSrsDrift, type AutoIngestSrsResult } from "../core/srs-auto";
import { getSrsFileDrift, type SrsFileDrift } from "../core/srs-state";

/** Max learnings in session inject - keep hooks fast. */
const INJECT_MAX_LEARNINGS = 10;

export interface ContextInjectLearning {
  id: string;
  category: Learning["category"];
  severity: Learning["severity"];
  title: string;
  detail: string;
  pinned: boolean;
}

export interface ContextInjectPayload {
  focus: string;
  learnings: ContextInjectLearning[];
  openDecisions: Decision[];
  orchestration: OrchestrationSummary;
  srsDrift: SrsFileDrift[];
  autoIngest: AutoIngestSrsResult;
  suggestedKnowledge: Array<{ id: string; title: string; hint: string }>;
  text: string;
}

export interface ContextInjectOptions {
  harnessDir?: string;
}

function formatOpenDecisionsSection(decisions: Decision[]): string {
  if (decisions.length === 0) {
    return "";
  }
  const lines: string[] = [
    "## Open Decisions - discuss with user before changing scoped code",
    "",
  ];
  for (const d of decisions) {
    lines.push(`- **${d.id}**: ${d.question}`);
    if (d.detail) {
      lines.push(`  ${d.detail}`);
    }
    lines.push(`  Scopes: ${d.scopes.join(", ")}`);
  }
  return lines.join("\n");
}

function formatOrchestrationSection(summary: OrchestrationSummary): string {
  const run = summary.activeRun;
  const step = summary.activeStep;
  if (!summary.enabled || !run || !step) {
    return "";
  }

  const lines: string[] = [
    "## Active Orchestration",
    "",
    `Run: ${run.id}`,
    `Goal: ${run.goal}`,
    `Workflow: ${run.workflow}`,
    `Scope: ${run.scope.join(", ")}`,
    `Current step: ${step.id} - ${step.title}`,
    `Role: ${step.role}`,
    `Allowed actions: ${step.allowedActions.join(", ")}`,
    "",
    "Role guidance:",
    step.instructions,
    "",
    "Next required command when this step is done:",
    '`contextpilot orchestrate advance --status complete --note "<evidence>" --json`',
  ];

  if (run.status === "blocked" || step.status === "blocked") {
    lines.push("", "This orchestration step is blocked; resolve the blocker before continuing.");
  }

  if ((summary.staleHours ?? 0) > 24) {
    lines.push(
      "",
      `Warning: no activity on this run in ${Math.floor(summary.staleHours ?? 0)}h - it may be abandoned. Resume it or cancel with \`contextpilot orchestrate cancel\`.`,
    );
  }

  return lines.join("\n");
}

function formatSrsDriftSection(drift: SrsFileDrift[]): string {
  if (drift.length === 0) {
    return "";
  }
  const lines: string[] = [
    "## SRS Source Drift - re-ingest before relying on this knowledge",
    "",
    "The following SRS source files are new or have changed since the last `srs ingest`:",
  ];
  for (const d of drift) {
    lines.push(`- [${d.kind}] ${d.path}`);
  }
  lines.push("", "Run `contextpilot srs ingest --reingest --json` before relying on SRS knowledge for these files.");
  return lines.join("\n");
}

function formatAutoIngestSection(autoIngest: AutoIngestSrsResult): string {
  if (autoIngest.status === "ingested") {
    return [
      "## SRS Auto-Ingest",
      "",
      `Updated ${autoIngest.drift.length} changed SRS source file(s) before injecting context.`,
    ].join("\n");
  }
  if (autoIngest.status !== "skipped" && autoIngest.status !== "failed") {
    return "";
  }
  return [
    "## SRS Auto-Ingest Skipped",
    "",
    `Status: ${autoIngest.status}`,
    `Reason: ${autoIngest.reason ?? "unknown"}`,
    "Run `contextpilot srs ingest --reingest --json` after resolving the issue.",
  ].join("\n");
}

function formatSuggestedKnowledgeSection(
  items: Array<{ id: string; title: string; hint: string }>,
): string {
  if (items.length === 0) {
    return "";
  }
  const lines: string[] = ["## Suggested Knowledge", ""];
  for (const item of items) {
    lines.push(`- **${item.id}** (${item.title}) — \`${item.hint}\``);
  }
  return lines.join("\n");
}

function resolveSuggestedKnowledge(
  harnessDir: string,
  orchestration: OrchestrationSummary,
  focus: string,
): Array<{ id: string; title: string; hint: string }> {
  const scopes: string[] = [];
  if (orchestration.activeRun?.scope) {
    scopes.push(...orchestration.activeRun.scope);
  }
  if (focus) {
    const globMatch = focus.match(/\*\*\/[^\s*]+/);
    if (globMatch) scopes.push(globMatch[0]);
  }
  if (scopes.length === 0) {
    return [];
  }

  const result = queryKnowledge(harnessDir, {
    scopes,
    task: "code",
    limit: 3,
    groupByModule: true,
  });
  if (result.results.length === 0) {
    return [];
  }

  const config = loadConfig(harnessDir);
  const scopeFile = scopes.find((scope) => !scope.includes("*"));
  const policy = resolveReadPolicy(
    "cursor" as AgentName,
    scopeFile,
    result.results,
    { knowledgeMode: config.agentContext.knowledgeMode },
  );

  return result.results.map((r) => ({
    id: r.id,
    title: r.title,
    hint:
      policy.policy === "knowledge-show-once" || policy.policy === "skip-body-read"
        ? policy.hint
        : `knowledge show ${r.id}`,
  }));
}

function formatInjectText(
  focus: string,
  learnings: Learning[],
  openDecisions: Decision[],
  orchestration: OrchestrationSummary,
  srsDrift: SrsFileDrift[],
  autoIngest: AutoIngestSrsResult,
  suggestedKnowledge: Array<{ id: string; title: string; hint: string }>,
): string {
  const sections: string[] = ["# Harness Session Context", ""];

  sections.push(
    "## Agent Automation Contract",
    "",
    "The user should chat normally. Run ContextPilot commands yourself; ask the user only product, business, requirement, or approval questions.",
    "",
  );

  const orchestrationText = formatOrchestrationSection(orchestration);
  if (orchestrationText) {
    sections.push(orchestrationText, "");
  }

  if (focus) {
    sections.push("## Current Focus", "", focus, "");
  }

  const learningsText = formatLearningsSection(learnings, learnings.length);
  if (learningsText) {
    sections.push("## Top Learnings", "", learningsText, "");
  }

  const decisionsText = formatOpenDecisionsSection(openDecisions);
  if (decisionsText) {
    sections.push(decisionsText, "");
  }

  const srsDriftText = formatSrsDriftSection(srsDrift);
  if (srsDriftText) {
    sections.push(srsDriftText, "");
  }

  const autoIngestText = formatAutoIngestSection(autoIngest);
  if (autoIngestText) {
    sections.push(autoIngestText, "");
  }

  const suggestedText = formatSuggestedKnowledgeSection(suggestedKnowledge);
  if (suggestedText) {
    sections.push(suggestedText, "");
  }

  return sections.join("\n").trim();
}

/**
 * Build session-inject payload for hooks (Cursor sessionStart, Claude SessionStart).
 * Read-only - no network or codebase scan.
 */
export async function formatInjectPayload(harnessDir: string): Promise<ContextInjectPayload> {
  const autoIngest = await autoIngestSrsDrift(harnessDir);
  const config = loadConfig(harnessDir);
  const maxLearnings = Math.min(config.maxLearningsPerFile, INJECT_MAX_LEARNINGS);
  const focus = readFocus(harnessDir);
  const sorted = sortLearnings(readActiveLearnings(harnessDir)).slice(0, maxLearnings);
  const openDecisions = listOpenDecisions(harnessDir);
  const orchestration = getOrchestrationSummary(harnessDir);
  const srsDrift = getSrsFileDrift(harnessDir);
  const suggestedKnowledge = resolveSuggestedKnowledge(harnessDir, orchestration, focus);
  const text = formatInjectText(
    focus,
    sorted,
    openDecisions,
    orchestration,
    srsDrift,
    autoIngest,
    suggestedKnowledge,
  );

  return {
    focus,
    learnings: sorted.map((l) => ({
      id: l.id,
      category: l.category,
      severity: l.severity,
      title: l.title,
      detail: l.detail,
      pinned: l.pinned,
    })),
    openDecisions,
    orchestration,
    srsDrift,
    autoIngest,
    suggestedKnowledge,
    text,
  };
}

/** CLI + hook entry: `context --inject [--json]`. */
export async function runContextInject(options: ContextInjectOptions = {}): Promise<void> {
  const harnessDir = options.harnessDir ?? requireHarness();
  const payload = await formatInjectPayload(harnessDir);

  const human = payload.text || "No harness context to inject.";
  out(human, {
    status: "injected",
    focus: payload.focus,
    learnings: payload.learnings,
    openDecisions: payload.openDecisions,
    orchestration: payload.orchestration,
    srsDrift: payload.srsDrift,
    autoIngest: payload.autoIngest,
    suggestedKnowledge: payload.suggestedKnowledge,
    text: payload.text,
  });
  process.exit(EXIT_OK);
}
