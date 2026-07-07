import * as fs from "node:fs";
import { nanoid } from "nanoid";
import { loadConfig, resolveProjectPath } from "./config-io";
import { appendLine, warn, withLock } from "./io";
import {
  orchestrationEventSchema,
  orchestrationRunSchema,
  type OrchestrationEvent,
  type OrchestrationRun,
  type OrchestrationRunStatus,
  type OrchestrationStep,
  type OrchestrationStepStatus,
  type OrchestrationWorkflow,
} from "./orchestration-schema";
import { getStateFilePath, loadState, saveState } from "./state";

export interface StartRunInput {
  goal: string;
  scope: string[];
  workflow?: OrchestrationWorkflow;
}

export interface AdvanceRunInput {
  status: "complete" | "blocked" | "failed";
  note?: string;
}

export interface AppendEventInput {
  runId: string;
  stepId?: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface OrchestrationSummary {
  enabled: boolean;
  activeRunId?: string;
  activeRun?: OrchestrationRun;
  activeStep?: OrchestrationStep;
  blocked: boolean;
  latestEventAt?: string;
  staleHours?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function builtInCodingSteps(): OrchestrationStep[] {
  return [
    {
      id: "plan",
      kind: "plan",
      role: "planner",
      title: "Plan the work",
      instructions:
        "Understand the goal, inspect relevant context, identify risks, and produce a concrete implementation plan before editing files.",
      allowedActions: ["read", "status", "decision-open", "orchestrate-advance"],
      status: "active",
    },
    {
      id: "implement",
      kind: "implement",
      role: "implementer",
      title: "Implement within scope",
      instructions:
        "Make the planned code changes only inside the orchestration scope. Open a decision if business logic is ambiguous.",
      allowedActions: ["read", "edit", "shell", "test", "decision-open", "learn"],
      status: "pending",
    },
    {
      id: "review",
      kind: "review",
      role: "reviewer",
      title: "Review the change",
      instructions:
        "Review the diff for bugs, regressions, missing tests, unsafe behavior, and violations of project rules. Do not edit files in this step.",
      allowedActions: ["read", "shell", "status", "decision-open"],
      status: "pending",
    },
    {
      id: "verify",
      kind: "verify",
      role: "verifier",
      title: "Verify behavior",
      instructions:
        "Run the relevant build, tests, or checks. Record failures as evidence and move back only after fixing them in an implementation step.",
      allowedActions: ["read", "shell", "test", "status"],
      status: "pending",
    },
    {
      id: "checkpoint",
      kind: "checkpoint",
      role: "verifier",
      title: "Checkpoint and sync",
      instructions:
        "Record any durable learning, run checkpoint or sync, and prepare a concise completion summary.",
      allowedActions: ["read", "learn", "sync", "checkpoint", "orchestrate-advance"],
      status: "pending",
    },
  ];
}

function runsPath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  return resolveProjectPath(harnessDir, config.orchestration.runsFile);
}

function eventsPath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  return resolveProjectPath(harnessDir, config.orchestration.eventsFile);
}

function readRunRecords(harnessDir: string): OrchestrationRun[] {
  const filePath = runsPath(harnessDir);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim());
  const runs: OrchestrationRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      runs.push(orchestrationRunSchema.parse(JSON.parse(line)));
    } catch {
      warn(`Skipping corrupt orchestration run line ${i + 1} in ${filePath}`);
    }
  }
  return runs;
}

function readEventRecords(harnessDir: string): OrchestrationEvent[] {
  const filePath = eventsPath(harnessDir);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim());
  const events: OrchestrationEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      events.push(orchestrationEventSchema.parse(JSON.parse(line)));
    } catch {
      warn(`Skipping corrupt orchestration event line ${i + 1} in ${filePath}`);
    }
  }
  return events;
}

function writeRunRecord(harnessDir: string, run: OrchestrationRun): void {
  appendLine(runsPath(harnessDir), JSON.stringify(orchestrationRunSchema.parse(run)));
}

export function appendOrchestrationEvent(
  harnessDir: string,
  input: AppendEventInput,
): OrchestrationEvent {
  const event: OrchestrationEvent = {
    id: `evt_${nanoid(8)}`,
    runId: input.runId,
    stepId: input.stepId,
    type: input.type,
    message: input.message,
    data: input.data,
    createdAt: nowIso(),
  };
  appendLine(eventsPath(harnessDir), JSON.stringify(orchestrationEventSchema.parse(event)));
  return event;
}

export function listRuns(harnessDir: string): OrchestrationRun[] {
  const latest = new Map<string, OrchestrationRun>();
  for (const run of readRunRecords(harnessDir)) {
    latest.set(run.id, run);
  }
  return [...latest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listEvents(harnessDir: string): OrchestrationEvent[] {
  return readEventRecords(harnessDir);
}

export function getRunById(
  harnessDir: string,
  id: string,
): OrchestrationRun | undefined {
  return listRuns(harnessDir).find((run) => run.id === id);
}

export function getActiveRun(harnessDir: string): OrchestrationRun | undefined {
  const state = loadState(harnessDir);
  const id = state.orchestration.activeRunId;
  return id ? getRunById(harnessDir, id) : undefined;
}

export function getActiveStep(run: OrchestrationRun): OrchestrationStep | undefined {
  return run.activeStepId
    ? run.steps.find((step) => step.id === run.activeStepId)
    : undefined;
}

function latestEventAt(harnessDir: string, runId: string): string | undefined {
  const events = listEvents(harnessDir).filter((event) => event.runId === runId);
  return events.at(-1)?.createdAt;
}

export function getOrchestrationSummary(harnessDir: string): OrchestrationSummary {
  const config = loadConfig(harnessDir);
  if (!config.orchestration.enabled) {
    return { enabled: false, blocked: false };
  }
  const state = loadState(harnessDir);
  const activeRunId = state.orchestration.activeRunId;
  const activeRun = activeRunId ? getRunById(harnessDir, activeRunId) : undefined;
  const activeStep = activeRun ? getActiveStep(activeRun) : undefined;
  const lastEventAt = activeRun ? latestEventAt(harnessDir, activeRun.id) : undefined;
  const referenceTime = lastEventAt ?? activeRun?.updatedAt;
  const staleHours = activeRun && referenceTime
    ? (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60)
    : undefined;
  return {
    enabled: true,
    activeRunId,
    activeRun,
    activeStep,
    blocked: activeRun?.status === "blocked" || activeStep?.status === "blocked",
    latestEventAt: lastEventAt,
    staleHours,
  };
}

export async function startRun(
  harnessDir: string,
  input: StartRunInput,
): Promise<OrchestrationRun> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => {
    const config = loadConfig(harnessDir);
    const state = loadState(harnessDir);
    if (state.orchestration.activeRunId) {
      const active = getRunById(harnessDir, state.orchestration.activeRunId);
      if (active && ["active", "blocked", "failed"].includes(active.status)) {
        throw new Error(`Active orchestration run already exists: ${active.id}`);
      }
    }

    const workflow = input.workflow ?? config.orchestration.defaultWorkflow;
    const timestamp = nowIso();
    const run: OrchestrationRun = {
      id: `run_${nanoid(8)}`,
      goal: input.goal,
      scope: input.scope,
      workflow,
      status: "active",
      steps: builtInCodingSteps(),
      activeStepId: "plan",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeRunRecord(harnessDir, run);
    state.orchestration.activeRunId = run.id;
    saveState(harnessDir, state);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: run.activeStepId,
      type: "run_started",
      message: `Started orchestration run: ${run.goal}`,
      data: { scope: run.scope, workflow: run.workflow },
    });
    return run;
  });
}

function mapAdvanceStatus(status: AdvanceRunInput["status"]): OrchestrationStepStatus {
  if (status === "complete") return "completed";
  return status;
}

function nextPendingStep(steps: OrchestrationStep[]): OrchestrationStep | undefined {
  return steps.find((step) => step.status === "pending");
}

export async function advanceRun(
  harnessDir: string,
  input: AdvanceRunInput,
): Promise<OrchestrationRun> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => {
    const state = loadState(harnessDir);
    const activeRunId = state.orchestration.activeRunId;
    if (!activeRunId) {
      throw new Error("No active orchestration run.");
    }
    const run = getRunById(harnessDir, activeRunId);
    if (!run) {
      throw new Error(`Active orchestration run not found: ${activeRunId}`);
    }
    const activeStep = getActiveStep(run);
    if (!activeStep) {
      throw new Error(`Active step not found for run: ${run.id}`);
    }

    const stepStatus = mapAdvanceStatus(input.status);
    const steps = run.steps.map((step) =>
      step.id === activeStep.id
        ? { ...step, status: stepStatus, evidence: input.note ?? step.evidence }
        : step,
    );
    const updatedAt = nowIso();

    let nextActiveStepId: string | undefined = run.activeStepId;
    let runStatus: OrchestrationRunStatus = run.status;
    let completedAt = run.completedAt;

    if (input.status === "complete") {
      const next = nextPendingStep(steps);
      if (next) {
        nextActiveStepId = next.id;
        for (const step of steps) {
          if (step.id === next.id) {
            step.status = "active";
          }
        }
        runStatus = "active";
      } else {
        nextActiveStepId = undefined;
        runStatus = "completed";
        completedAt = updatedAt;
        state.orchestration.activeRunId = undefined;
      }
    } else {
      runStatus = input.status;
    }

    const updated: OrchestrationRun = {
      ...run,
      status: runStatus,
      steps,
      activeStepId: nextActiveStepId,
      updatedAt,
      completedAt,
      note: input.note ?? run.note,
    };
    writeRunRecord(harnessDir, updated);
    saveState(harnessDir, state);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: activeStep.id,
      type: input.status === "complete" ? "step_completed" : `step_${input.status}`,
      message: input.note ?? `${activeStep.title}: ${input.status}`,
      data: { nextStepId: nextActiveStepId, runStatus },
    });
    if (runStatus === "completed") {
      appendOrchestrationEvent(harnessDir, {
        runId: run.id,
        type: "run_completed",
        message: `Completed orchestration run: ${run.goal}`,
      });
    }
    return updated;
  });
}

export async function cancelRun(
  harnessDir: string,
  reason: string,
): Promise<OrchestrationRun> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => {
    const state = loadState(harnessDir);
    const activeRunId = state.orchestration.activeRunId;
    if (!activeRunId) {
      throw new Error("No active orchestration run.");
    }
    const run = getRunById(harnessDir, activeRunId);
    if (!run) {
      throw new Error(`Active orchestration run not found: ${activeRunId}`);
    }
    const timestamp = nowIso();
    const canceled: OrchestrationRun = {
      ...run,
      status: "canceled",
      updatedAt: timestamp,
      canceledAt: timestamp,
      note: reason,
    };
    writeRunRecord(harnessDir, canceled);
    state.orchestration.activeRunId = undefined;
    saveState(harnessDir, state);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: run.activeStepId,
      type: "run_canceled",
      message: reason,
    });
    return canceled;
  });
}
