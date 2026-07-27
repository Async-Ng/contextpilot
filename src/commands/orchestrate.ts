import {
  advanceRun,
  appendOrchestrationEvent,
  cancelRun,
  expandRunScope,
  getActiveStep,
  getOrchestrationSummary,
  reopenRun,
  startRun,
  runVerification,
} from "../core/orchestration";
import { runContractSchema, type OrchestrationWorkflow } from "../core/orchestration-schema";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  EXIT_GENERAL,
  EXIT_OK,
  errOut,
  exitMissingFlag,
  out,
  requireHarness,
} from "../core/io";

export interface OrchestrateStartOptions {
  goal?: string;
  scope?: string;
  workflow?: string;
  preset?: string;
  contract?: string;
}

export interface OrchestrateAdvanceOptions {
  status?: "complete" | "blocked" | "failed";
  note?: string;
  expectedRevision?: number;
}

export interface OrchestrateCancelOptions {
  reason?: string;
}

export interface OrchestrateEventOptions {
  type?: string;
  message?: string;
}

export interface OrchestrateReopenOptions {
  step?: string;
  reason?: string;
  expectedRevision?: number;
}

export interface OrchestrateScopeAddOptions {
  scope?: string;
  reason?: string;
  expectedRevision?: number;
}

export interface OrchestrateVerifyOptions { expectedRevision?: number; }

function parseScope(scope: string): string[] {
  return scope.split(",").map((s) => s.trim()).filter(Boolean);
}

function readContract(cwd: string, contractPath?: string) {
  if (!contractPath) return undefined;
  return runContractSchema.parse(JSON.parse(fs.readFileSync(path.resolve(cwd, contractPath), "utf8")));
}

function fail(message: string, jsonObj: unknown): never {
  errOut(message, jsonObj);
  process.exit(EXIT_GENERAL);
}

export async function runOrchestrateStart(
  options: OrchestrateStartOptions,
): Promise<void> {
  const harnessDir = requireHarness();
  if (!options.goal) {
    exitMissingFlag("--goal", "Describe the orchestration goal.");
  }
  if (!options.scope) {
    exitMissingFlag("--scope", 'Affected file globs, e.g. --scope "src/**".');
  }

  const workflow = (options.workflow ?? "coding") as OrchestrationWorkflow;
  if (workflow !== "coding") {
    fail(`Unknown workflow: ${workflow}`, {
      error: "unknown_workflow",
      workflow,
      supported: ["coding"],
    });
  }

  const preset = options.preset ?? "coding";
  if (!["coding", "lightweight"].includes(preset)) {
    fail(`Unknown orchestration preset: ${preset}`, {
      error: "unknown_preset",
      preset,
      supported: ["coding", "lightweight"],
    });
  }

  try {
    const run = await startRun(harnessDir, {
      goal: options.goal,
      scope: parseScope(options.scope),
      workflow,
      preset: preset as "coding" | "lightweight",
      contract: readContract(path.dirname(harnessDir), options.contract),
    });
    const step = getActiveStep(run);
    out(`Orchestration started: ${run.id}\nCurrent step: ${step?.title ?? "none"}`, {
      status: "started",
      run,
      activeStep: step,
    });
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message, { error: "orchestration_start_failed", message });
  }
}

export async function runOrchestrateReopen(
  options: OrchestrateReopenOptions,
): Promise<void> {
  const harnessDir = requireHarness();
  if (!options.step) {
    exitMissingFlag("--step", "Step to reopen, e.g. --step implement.");
  }
  if (!options.reason) {
    exitMissingFlag("--reason", "Explain why this step is being reopened.");
  }
  try {
    const run = await reopenRun(harnessDir, {
      stepId: options.step,
      reason: options.reason,
      expectedRevision: options.expectedRevision,
    });
    const step = getActiveStep(run);
    out(`Orchestration reopened: ${run.id}\nCurrent step: ${step?.title ?? "none"}`, {
      status: "reopened",
      run,
      activeStep: step,
    });
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message, { error: "orchestration_reopen_failed", message });
  }
}

export async function runOrchestrateScopeAdd(
  options: OrchestrateScopeAddOptions,
): Promise<void> {
  const harnessDir = requireHarness();
  if (!options.scope) {
    exitMissingFlag("--scope", 'Scope glob(s) to add, e.g. --scope ".github/**".');
  }
  if (!options.reason) {
    exitMissingFlag("--reason", "Explain why the scope needs to expand.");
  }
  try {
    const result = await expandRunScope(harnessDir, {
      scope: parseScope(options.scope),
      reason: options.reason,
      expectedRevision: options.expectedRevision,
    });
    out(`Orchestration scope expanded: ${result.run.id}`, {
      status: "scope_expanded",
      run: result.run,
      previousScope: result.previousScope,
      nextScope: result.nextScope,
      addedScope: result.addedScope,
    });
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message, { error: "orchestration_scope_add_failed", message });
  }
}

export function runOrchestrateStatus(): void {
  const harnessDir = requireHarness();
  const summary = getOrchestrationSummary(harnessDir);
  const run = summary.activeRun;
  const step = summary.activeStep;
  const human = run
    ? [
        `Active orchestration: ${run.id}`,
        `Goal: ${run.goal}`,
        `Status: ${run.status}`,
        `Current step: ${step ? `${step.id} (${step.role})` : "none"}`,
        `Scope: ${run.scope.join(", ")}`,
      ].join("\n")
    : summary.enabled
      ? "No active orchestration run."
      : "Orchestration is disabled.";

  out(human, { status: "orchestration_status", orchestration: summary });
  process.exit(EXIT_OK);
}

export async function runOrchestrateAdvance(
  options: OrchestrateAdvanceOptions,
): Promise<void> {
  const harnessDir = requireHarness();
  if (!options.status) {
    exitMissingFlag("--status", "Use complete, blocked, or failed.");
  }
  if (!["complete", "blocked", "failed"].includes(options.status)) {
    fail(`Unknown advance status: ${options.status}`, {
      error: "unknown_advance_status",
      status: options.status,
      supported: ["complete", "blocked", "failed"],
    });
  }
  try {
    const run = await advanceRun(harnessDir, {
      status: options.status,
      note: options.note,
      expectedRevision: options.expectedRevision,
    });
    const step = getActiveStep(run);
    out(
      run.status === "completed"
        ? `Orchestration completed: ${run.id}`
        : `Orchestration advanced: ${run.id}\nCurrent step: ${step?.title ?? "none"}`,
      { status: "advanced", run, activeStep: step },
    );
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message, { error: "orchestration_advance_failed", message });
  }
}

export async function runOrchestrateVerify(options: OrchestrateVerifyOptions): Promise<void> {
  const harnessDir = requireHarness();
  try {
    const run = await runVerification(harnessDir, options.expectedRevision);
    out(`Verification recorded for ${run.id}.`, {
      status: "verification_recorded",
      run,
      activeStep: getActiveStep(run),
    });
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message, { error: "verification_failed", message });
  }
}

export async function runOrchestrateCancel(
  options: OrchestrateCancelOptions,
): Promise<void> {
  const harnessDir = requireHarness();
  if (!options.reason) {
    exitMissingFlag("--reason", "Explain why the active run is being canceled.");
  }
  try {
    const run = await cancelRun(harnessDir, options.reason);
    out(`Orchestration canceled: ${run.id}`, { status: "canceled", run });
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message, { error: "orchestration_cancel_failed", message });
  }
}

export function runOrchestrateEvent(options: OrchestrateEventOptions): void {
  const harnessDir = requireHarness();
  if (!options.type) {
    exitMissingFlag("--type", "Event type to record.");
  }
  if (!options.message) {
    exitMissingFlag("--message", "Event message to record.");
  }

  const summary = getOrchestrationSummary(harnessDir);
  const run = summary.activeRun;
  if (!run) {
    fail("No active orchestration run.", { error: "no_active_run" });
  }

  const event = appendOrchestrationEvent(harnessDir, {
    runId: run.id,
    stepId: summary.activeStep?.id,
    type: options.type,
    message: options.message,
  });
  out(`Orchestration event recorded: ${event.id}`, {
    status: "event_recorded",
    event,
  });
  process.exit(EXIT_OK);
}
