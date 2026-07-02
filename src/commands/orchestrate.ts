import {
  advanceRun,
  appendOrchestrationEvent,
  cancelRun,
  getActiveStep,
  getOrchestrationSummary,
  startRun,
} from "../core/orchestration";
import type { OrchestrationWorkflow } from "../core/orchestration-schema";
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
}

export interface OrchestrateAdvanceOptions {
  status?: "complete" | "blocked" | "failed";
  note?: string;
}

export interface OrchestrateCancelOptions {
  reason?: string;
}

export interface OrchestrateEventOptions {
  type?: string;
  message?: string;
}

function parseScope(scope: string): string[] {
  return scope.split(",").map((s) => s.trim()).filter(Boolean);
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

  try {
    const run = await startRun(harnessDir, {
      goal: options.goal,
      scope: parseScope(options.scope),
      workflow,
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
