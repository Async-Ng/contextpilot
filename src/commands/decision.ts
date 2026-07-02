import { loadConfig } from "../core/config-io";
import type { ConfirmMode } from "../core/config";
import type { Decision } from "../core/decisions";
import {
  appendDecision,
  listOpenDecisions,
  readAllDecisions,
  rejectDecision,
  resolveDecision,
} from "../core/decisions";
import {
  EXIT_GENERAL,
  EXIT_OK,
  exitMissingFlag,
  exitRequiresHuman,
  out,
  requireHarness,
} from "../core/io";
import { readActiveLearnings, resolveLearning } from "../core/memory";
import { defaultFrontmatter, writeRule } from "../core/rules";
import { runSync } from "../core/sync";

export interface DecisionOpenOptions {
  area?: string;
  scope?: string;
  question?: string;
  detail?: string;
  srsRef?: string;
  proposal?: string;
  options?: string;
}

export interface DecisionListOptions {
  open?: boolean;
}

export interface DecisionResolveOptions {
  resolution?: string;
}

export interface DecisionRejectOptions {
  reason?: string;
}

function parseScopeList(scope?: string, area?: string): string[] {
  if (scope) {
    return scope.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (area) {
    return [area.trim()];
  }
  return [];
}

function buildOpenDetail(options: DecisionOpenOptions): string {
  if (options.detail) {
    return options.detail;
  }
  const parts: string[] = [];
  if (options.proposal) {
    parts.push(`Proposal: ${options.proposal}`);
  }
  if (options.options) {
    const opts = options.options
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (opts.length > 0) {
      parts.push(`Options: ${opts.join(" | ")}`);
    }
  }
  return parts.join("\n");
}

function assertResolveAllowed(
  harnessDir: string,
  decision: Decision,
): void {
  const config = loadConfig(harnessDir);
  const mode: ConfirmMode = config.gate.confirmMode;

  if (mode === "chat") {
    return;
  }

  if (process.stdout.isTTY === true) {
    return;
  }

  if (mode === "high-severity-terminal" && decision.sourceItemId) {
    const linked = readActiveLearnings(harnessDir).find(
      (l) => l.sourceItemId === decision.sourceItemId,
    );
    if (!linked || linked.severity !== "high") {
      return;
    }
  }

  exitRequiresHuman("decision resolve");
}

function decisionRuleId(decisionId: string): string {
  return `decision-${decisionId}`;
}

function formatDecisionSummary(decision: Decision): string {
  return `${decision.id} [${decision.status}] ${decision.question}`;
}

export async function runDecisionOpen(
  options: DecisionOpenOptions,
): Promise<void> {
  const harnessDir = requireHarness();

  if (!options.question) {
    exitMissingFlag("--question", "The business question to discuss with the user");
  }

  const scopes = parseScopeList(options.scope, options.area);
  if (scopes.length === 0) {
    exitMissingFlag(
      "--scope or --area",
      'Glob pattern for affected files, e.g. --scope "src/**" or --area "src/auth/**"',
    );
  }

  const decision = await appendDecision(harnessDir, {
    question: options.question,
    detail: buildOpenDetail(options),
    scopes,
    sourceItemId: options.srsRef,
  });

  out(`Discussion opened: ${decision.id}`, {
    status: "discussion_opened",
    id: decision.id,
    blocked: true,
  });
  process.exit(EXIT_OK);
}

export function runDecisionList(options: DecisionListOptions): void {
  const harnessDir = requireHarness();
  const decisions = options.open
    ? listOpenDecisions(harnessDir)
    : readAllDecisions(harnessDir);

  const human = decisions.length
    ? decisions.map(formatDecisionSummary).join("\n")
    : options.open
      ? "No open decisions."
      : "No decisions recorded.";

  out(human, {
    status: "listed",
    count: decisions.length,
    decisions,
  });
  process.exit(EXIT_OK);
}

export async function runDecisionResolve(
  id: string,
  options: DecisionResolveOptions,
): Promise<void> {
  const harnessDir = requireHarness();

  if (!options.resolution) {
    exitMissingFlag(
      "--resolution",
      'Record the user\'s decision, e.g. --resolution "Use JWT with 15m expiry"',
    );
  }

  const open = listOpenDecisions(harnessDir).find((d) => d.id === id);
  if (!open) {
    out(`Open decision not found: ${id}`, { error: "not_found", id });
    process.exit(EXIT_GENERAL);
  }

  assertResolveAllowed(harnessDir, open);

  const resolved = await resolveDecision(harnessDir, id, options.resolution);
  if (!resolved) {
    out(`Failed to resolve decision: ${id}`, { error: "resolve_failed", id });
    process.exit(EXIT_GENERAL);
  }

  const config = loadConfig(harnessDir);
  const ruleId = decisionRuleId(resolved.id);
  writeRule(
    harnessDir,
    ruleId,
    defaultFrontmatter(config, {
      id: ruleId,
      title: `Decision: ${resolved.question}`,
      type: "knowledge",
      scope: resolved.scopes,
      priority: "high",
      tags: ["decision", resolved.id],
    }),
    resolved.resolution ?? options.resolution,
  );

  let learningResolved: string | undefined;
  if (resolved.sourceItemId) {
    const linked = readActiveLearnings(harnessDir).find(
      (l) => l.sourceItemId === resolved.sourceItemId,
    );
    if (linked) {
      const ok = await resolveLearning(harnessDir, linked.id);
      if (ok) {
        learningResolved = linked.id;
      }
    }
  }

  await runSync(harnessDir);

  out(`Decision resolved: ${id} → rule ${ruleId}`, {
    status: "resolved",
    id: resolved.id,
    ruleId,
    learningResolved,
  });
  process.exit(EXIT_OK);
}

export async function runDecisionReject(
  id: string,
  options: DecisionRejectOptions,
): Promise<void> {
  const harnessDir = requireHarness();

  if (!options.reason) {
    exitMissingFlag(
      "--reason",
      'Why the discussion was rejected, e.g. --reason "Out of scope for this sprint"',
    );
  }

  const open = listOpenDecisions(harnessDir).find((d) => d.id === id);
  if (!open) {
    out(`Open decision not found: ${id}`, { error: "not_found", id });
    process.exit(EXIT_GENERAL);
  }

  const rejected = await rejectDecision(harnessDir, id);
  if (!rejected) {
    out(`Failed to reject decision: ${id}`, { error: "reject_failed", id });
    process.exit(EXIT_GENERAL);
  }

  await runSync(harnessDir);

  out(`Decision rejected: ${id}`, {
    status: "rejected",
    id: rejected.id,
    reason: options.reason,
  });
  process.exit(EXIT_OK);
}
