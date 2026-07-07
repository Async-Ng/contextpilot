import { loadConfig } from "../core/config-io";
import { readFocus } from "../core/context";
import { listOpenDecisions, type Decision } from "../core/decisions";
import { EXIT_OK, out, requireHarness } from "../core/io";
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

function formatInjectText(
  focus: string,
  learnings: Learning[],
  openDecisions: Decision[],
  orchestration: OrchestrationSummary,
  srsDrift: SrsFileDrift[],
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

  return sections.join("\n").trim();
}

/**
 * Build session-inject payload for hooks (Cursor sessionStart, Claude SessionStart).
 * Read-only - no network or codebase scan.
 */
export function formatInjectPayload(harnessDir: string): ContextInjectPayload {
  const config = loadConfig(harnessDir);
  const maxLearnings = Math.min(config.maxLearningsPerFile, INJECT_MAX_LEARNINGS);
  const focus = readFocus(harnessDir);
  const sorted = sortLearnings(readActiveLearnings(harnessDir)).slice(0, maxLearnings);
  const openDecisions = listOpenDecisions(harnessDir);
  const orchestration = getOrchestrationSummary(harnessDir);
  const srsDrift = getSrsFileDrift(harnessDir);
  const text = formatInjectText(focus, sorted, openDecisions, orchestration, srsDrift);

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
    text,
  };
}

/** CLI + hook entry: `context --inject [--json]`. */
export function runContextInject(options: ContextInjectOptions = {}): void {
  const harnessDir = options.harnessDir ?? requireHarness();
  const payload = formatInjectPayload(harnessDir);

  const human = payload.text || "No harness context to inject.";
  out(human, {
    status: "injected",
    focus: payload.focus,
    learnings: payload.learnings,
    openDecisions: payload.openDecisions,
    orchestration: payload.orchestration,
    srsDrift: payload.srsDrift,
    text: payload.text,
  });
  process.exit(EXIT_OK);
}
