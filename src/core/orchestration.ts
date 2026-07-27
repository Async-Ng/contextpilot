import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { nanoid } from "nanoid";
import { loadConfig } from "./config-io";
import { appendLine, sha256, warn, withLock } from "./io";
import { getGitDiffDigest, getGitWorktreeIdentity } from "./git";
import {
  orchestrationEventSchema,
  orchestrationRunSchema,
  type OrchestrationEvent,
  type OrchestrationRun,
  type OrchestrationRunStatus,
  type OrchestrationStep,
  type OrchestrationStepStatus,
  type OrchestrationWorkflow,
  type RunContract,
  type VerificationEvidence,
} from "./orchestration-schema";
import {
  getOrchestrationEventsFilePath,
  getOrchestrationRunsFilePath,
  getRuntimeActiveRunId,
  getRuntimeStateFilePath,
  isRuntimeExternalized,
  setRuntimeActiveRunId,
} from "./runtime";
import { getStateFilePath } from "./state";

export interface StartRunInput {
  goal: string;
  scope: string[];
  workflow?: OrchestrationWorkflow;
  preset?: "coding" | "lightweight";
  contract?: Partial<RunContract>;
}

export interface AdvanceRunInput {
  status: "complete" | "blocked" | "failed";
  note?: string;
  expectedRevision?: number;
}

export interface AppendEventInput {
  runId: string;
  stepId?: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
  outcome?: "ok" | "error" | "denied";
  errorCategory?: string;
}

export interface ReopenRunInput {
  stepId: string;
  reason: string;
  expectedRevision?: number;
}

export interface ExpandScopeInput {
  scope: string[];
  reason: string;
  expectedRevision?: number;
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

// `allowedActions` values are role-scoping hints shown to the agent (context.ts/status.ts
// display text) - only `"edit"` is mechanically enforced (see gate.ts's single check on it).
// Adding a new string here does not create an enforcement guarantee by itself.
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
      evidenceIds: [],
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
      evidenceIds: [],
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
      evidenceIds: [],
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
      evidenceIds: [],
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
      evidenceIds: [],
    },
  ];
}

function builtInLightweightSteps(): OrchestrationStep[] {
  return builtInCodingSteps()
    .filter((step) => ["implement", "verify", "checkpoint"].includes(step.id))
    .map((step, index) => ({
      ...step,
      status: index === 0 ? "active" : "pending",
    }));
}

function runsPath(harnessDir: string): string {
  return getOrchestrationRunsFilePath(harnessDir);
}

function eventsPath(harnessDir: string): string {
  return getOrchestrationEventsFilePath(harnessDir);
}

function orchestrationLockPath(harnessDir: string): string {
  return isRuntimeExternalized(harnessDir)
    ? getRuntimeStateFilePath(harnessDir)
    : getStateFilePath(harnessDir);
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
    traceId: `trace_${input.runId}`,
    spanId: `span_${nanoid(8)}`,
    outcome: input.outcome ?? "ok",
    errorCategory: input.errorCategory,
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
  const id = getRuntimeActiveRunId(harnessDir);
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
  const activeRunId = getRuntimeActiveRunId(harnessDir);
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
  const statePath = orchestrationLockPath(harnessDir);
  return withLock(statePath, () => {
    const config = loadConfig(harnessDir);
    const activeRunId = getRuntimeActiveRunId(harnessDir);
    if (activeRunId) {
      const active = getRunById(harnessDir, activeRunId);
      if (active && ["active", "blocked", "failed"].includes(active.status)) {
        throw new Error(`Active orchestration run already exists: ${active.id}`);
      }
    }

    const workflow = input.workflow ?? config.orchestration.defaultWorkflow;
    const preset = input.preset ?? config.orchestration.defaultPreset ?? "coding";
    const timestamp = nowIso();
    const steps = preset === "lightweight" ? builtInLightweightSteps() : builtInCodingSteps();
    const run: OrchestrationRun = {
      id: `run_${nanoid(8)}`,
      goal: input.goal,
      scope: input.scope,
      workflow,
      preset,
      revision: 0,
      contract: defaultContract(preset, input.contract),
      worktree: getGitWorktreeIdentity(path.dirname(harnessDir)),
      evidence: [],
      status: "active",
      steps,
      activeStepId: preset === "lightweight" ? "implement" : "plan",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeRunRecord(harnessDir, run);
    setRuntimeActiveRunId(harnessDir, run.id);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: run.activeStepId,
      type: "run_started",
      message: `Started orchestration run: ${run.goal}`,
      data: { scope: run.scope, workflow: run.workflow, preset: run.preset, revision: run.revision, contract: run.contract },
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

function assertRevision(run: OrchestrationRun, expectedRevision: number | undefined): void {
  if (expectedRevision !== undefined && run.revision !== expectedRevision) {
    throw new Error(`Run revision conflict: expected ${expectedRevision}, current ${run.revision}. Refresh with contextpilot orchestrate status --json.`);
  }
}

function defaultContract(preset: "coding" | "lightweight", contract?: Partial<RunContract>): RunContract {
  return {
    acceptanceCriteria: contract?.acceptanceCriteria ?? [],
    verificationCommands: contract?.verificationCommands ?? [],
    riskLevel: contract?.riskLevel ?? "low",
    permissions: {
      read: contract?.permissions?.read ?? true,
      write: contract?.permissions?.write ?? true,
      execute: contract?.permissions?.execute ?? true,
      network: contract?.permissions?.network ?? false,
      destructive: contract?.permissions?.destructive ?? false,
    },
    packs: contract?.packs ?? (preset === "lightweight" ? [] : ["refactor"]),
  };
}

export async function advanceRun(
  harnessDir: string,
  input: AdvanceRunInput,
): Promise<OrchestrationRun> {
  const statePath = orchestrationLockPath(harnessDir);
  return withLock(statePath, () => {
    const activeRunId = getRuntimeActiveRunId(harnessDir);
    if (!activeRunId) {
      throw new Error("No active orchestration run.");
    }
    const run = getRunById(harnessDir, activeRunId);
    if (!run) {
      throw new Error(`Active orchestration run not found: ${activeRunId}`);
    }
    assertRevision(run, input.expectedRevision);
    const activeStep = getActiveStep(run);
    if (!activeStep) {
      throw new Error(`Active step not found for run: ${run.id}`);
    }
    if (
      input.status === "complete" && activeStep.kind === "verify" &&
      run.contract.verificationCommands.length > 0 &&
      !run.evidence.some((item) => !item.stale && item.exitCode === 0)
    ) {
      throw new Error("Verification evidence is required. Run: contextpilot orchestrate verify --expected-revision " + run.revision + " --json");
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
        setRuntimeActiveRunId(harnessDir, undefined);
      }
    } else if (input.status === "failed" && ["review", "verify"].includes(activeStep.kind)) {
      const implementation = steps.find((step) => step.kind === "implement");
      if (!implementation) {
        throw new Error("Failed review cannot return to implementation because this workflow has no implement step.");
      }
      let afterImplementation = false;
      for (const step of steps) {
        if (step.id === implementation.id) {
          afterImplementation = true;
          step.status = "active";
        } else if (afterImplementation) {
          step.status = "pending";
        }
      }
      nextActiveStepId = implementation.id;
      runStatus = "active";
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
      revision: run.revision + 1,
    };
    writeRunRecord(harnessDir, updated);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: activeStep.id,
      type: input.status === "complete" ? "step_completed" : `step_${input.status}`,
      message: input.note ?? `${activeStep.title}: ${input.status}`,
      data: { nextStepId: nextActiveStepId, runStatus, revision: updated.revision },
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
  const statePath = orchestrationLockPath(harnessDir);
  return withLock(statePath, () => {
    const activeRunId = getRuntimeActiveRunId(harnessDir);
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
      revision: run.revision + 1,
      updatedAt: timestamp,
      canceledAt: timestamp,
      note: reason,
    };
    writeRunRecord(harnessDir, canceled);
    setRuntimeActiveRunId(harnessDir, undefined);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: run.activeStepId,
      type: "run_canceled",
      message: reason,
    });
    return canceled;
  });
}

export async function reopenRun(
  harnessDir: string,
  input: ReopenRunInput,
): Promise<OrchestrationRun> {
  const statePath = orchestrationLockPath(harnessDir);
  return withLock(statePath, () => {
    const activeRunId = getRuntimeActiveRunId(harnessDir);
    if (!activeRunId) {
      throw new Error("No active orchestration run.");
    }
    const run = getRunById(harnessDir, activeRunId);
    if (!run) {
      throw new Error(`Active orchestration run not found: ${activeRunId}`);
    }
    assertRevision(run, input.expectedRevision);
    const target = run.steps.find((step) => step.id === input.stepId);
    if (!target) {
      throw new Error(`Unknown orchestration step: ${input.stepId}`);
    }
    if (target.kind !== "implement") {
      throw new Error("Only implement steps can be reopened.");
    }

    let seenTarget = false;
    const steps = run.steps.map((step) => {
      if (step.id === target.id) {
        seenTarget = true;
        return { ...step, status: "active" as const, evidence: input.reason };
      }
      if (seenTarget) {
        return { ...step, status: "pending" as const, evidence: undefined };
      }
      return step;
    });
    const updated: OrchestrationRun = {
      ...run,
      status: "active",
      steps,
      activeStepId: target.id,
      updatedAt: nowIso(),
      note: input.reason,
      revision: run.revision + 1,
    };
    writeRunRecord(harnessDir, updated);
    setRuntimeActiveRunId(harnessDir, updated.id);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: target.id,
      type: "step_reopened",
      message: input.reason,
      data: {
        previousStepId: run.activeStepId,
        nextStepId: target.id,
        revision: updated.revision,
      },
    });
    return updated;
  });
}

export async function expandRunScope(
  harnessDir: string,
  input: ExpandScopeInput,
): Promise<{
  run: OrchestrationRun;
  previousScope: string[];
  nextScope: string[];
  addedScope: string[];
}> {
  const statePath = orchestrationLockPath(harnessDir);
  return withLock(statePath, () => {
    const activeRunId = getRuntimeActiveRunId(harnessDir);
    if (!activeRunId) {
      throw new Error("No active orchestration run.");
    }
    const run = getRunById(harnessDir, activeRunId);
    if (!run) {
      throw new Error(`Active orchestration run not found: ${activeRunId}`);
    }
    assertRevision(run, input.expectedRevision);
    const previousScope = run.scope;
    const nextScope = [...new Set([...run.scope, ...input.scope])];
    const addedScope = nextScope.filter((scope) => !run.scope.includes(scope));
    const updated: OrchestrationRun = {
      ...run,
      scope: nextScope,
      updatedAt: nowIso(),
      note: input.reason,
      revision: run.revision + 1,
    };
    writeRunRecord(harnessDir, updated);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: run.activeStepId,
      type: "scope_expanded",
      message: input.reason,
      data: { previousScope, nextScope, addedScope, revision: updated.revision },
    });
    return { run: updated, previousScope, nextScope, addedScope };
  });
}

export function getWorktreeMismatch(harnessDir: string, run: OrchestrationRun): string | undefined {
  if (!run.worktree) return undefined;
  const current = getGitWorktreeIdentity(path.dirname(harnessDir));
  if (path.resolve(current.worktreePath) !== path.resolve(run.worktree.worktreePath)) {
    return `Run ${run.id} is bound to worktree "${run.worktree.worktreePath}" but this command is running in "${current.worktreePath}". Start a new run in this worktree, or use the original worktree.`;
  }
  return undefined;
}

export async function runVerification(harnessDir: string, expectedRevision?: number): Promise<OrchestrationRun> {
  const statePath = orchestrationLockPath(harnessDir);
  return withLock(statePath, () => {
    const activeRunId = getRuntimeActiveRunId(harnessDir);
    if (!activeRunId) throw new Error("No active orchestration run.");
    const run = getRunById(harnessDir, activeRunId);
    if (!run) throw new Error(`Active orchestration run not found: ${activeRunId}`);
    assertRevision(run, expectedRevision);
    const mismatch = getWorktreeMismatch(harnessDir, run);
    if (mismatch) throw new Error(mismatch);
    const activeStep = getActiveStep(run);
    if (!activeStep || activeStep.kind !== "verify") {
      throw new Error("Verification can only run while the active step is verify.");
    }
    if (!run.contract.permissions.execute) {
      throw new Error("Run contract does not permit command execution.");
    }

    const config = loadConfig(harnessDir);
    const root = path.dirname(harnessDir);
    const diffDigest = getGitDiffDigest(harnessDir);
    const evidence: VerificationEvidence[] = run.contract.verificationCommands.map((command) => {
      const started = Date.now();
      const result = spawnSync(command, {
        cwd: root,
        shell: true,
        encoding: "utf8",
        maxBuffer: config.runtime.maxLogBytes,
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      return {
        id: `evidence_${nanoid(8)}`,
        command,
        exitCode: result.status ?? 1,
        durationMs: Date.now() - started,
        outputDigest: sha256(output),
        outputPreview: output.slice(-config.runtime.maxLogBytes),
        diffDigest,
        createdAt: nowIso(),
        stale: false,
      };
    });
    const failed = evidence.filter((item) => item.exitCode !== 0);
    const steps = run.steps.map((step) => {
      if (step.id === activeStep.id) {
        return { ...step, status: failed.length ? "failed" as const : "completed" as const, evidenceIds: evidence.map((item) => item.id) };
      }
      return step;
    });
    let activeStepId: string | undefined;
    let status: OrchestrationRunStatus = "active";
    if (failed.length) {
      const implementation = steps.find((step) => step.kind === "implement");
      if (!implementation) throw new Error("Verification failed but workflow has no implement step.");
      for (const step of steps) {
        if (step.kind === "implement") step.status = "active";
        else if (step.status !== "completed") step.status = "pending";
      }
      activeStepId = implementation.id;
    } else {
      const next = nextPendingStep(steps);
      if (next) {
        next.status = "active";
        activeStepId = next.id;
      } else {
        status = "completed";
      }
    }
    const updated: OrchestrationRun = {
      ...run,
      status,
      steps,
      activeStepId,
      evidence: [...run.evidence.map((item) => ({ ...item, stale: item.diffDigest !== diffDigest })), ...evidence],
      revision: run.revision + 1,
      updatedAt: nowIso(),
      handoff: {
        completedWork: failed.length ? "Verification ran and found failures." : "Verification completed successfully.",
        currentDiffDigest: diffDigest,
        failedChecks: failed.map((item) => item.command),
        nextAction: failed.length ? "Fix the failed verification commands in implement." : "Review the verified diff.",
        unresolvedAssumptions: [],
        createdAt: nowIso(),
      },
    };
    writeRunRecord(harnessDir, updated);
    appendOrchestrationEvent(harnessDir, {
      runId: run.id,
      stepId: activeStep.id,
      type: failed.length ? "verification_failed" : "verification_completed",
      message: failed.length ? `${failed.length} verification command(s) failed.` : "Verification commands passed.",
      data: { evidenceIds: evidence.map((item) => item.id), nextStepId: activeStepId, revision: updated.revision },
      outcome: failed.length ? "error" : "ok",
      errorCategory: failed.length ? "verification" : undefined,
    });
    return updated;
  });
}
