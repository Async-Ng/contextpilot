import { z } from "zod";

export const orchestrationWorkflowSchema = z.enum(["coding"]);
export const orchestrationRunStatusSchema = z.enum([
  "active",
  "blocked",
  "failed",
  "completed",
  "canceled",
]);
export const orchestrationStepStatusSchema = z.enum([
  "pending",
  "active",
  "completed",
  "blocked",
  "failed",
]);
export const orchestrationStepKindSchema = z.enum([
  "plan",
  "implement",
  "review",
  "verify",
  "checkpoint",
]);
export const orchestrationRoleSchema = z.enum([
  "planner",
  "implementer",
  "reviewer",
  "verifier",
]);

export const orchestrationStepSchema = z.object({
  id: z.string(),
  kind: orchestrationStepKindSchema,
  role: orchestrationRoleSchema,
  title: z.string(),
  instructions: z.string(),
  allowedActions: z.array(z.string()),
  status: orchestrationStepStatusSchema,
  evidence: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
});

export const runContractSchema = z.object({
  acceptanceCriteria: z.array(z.string()).default([]),
  verificationCommands: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  permissions: z.object({
    read: z.boolean().default(true),
    write: z.boolean().default(true),
    execute: z.boolean().default(true),
    network: z.boolean().default(false),
    destructive: z.boolean().default(false),
  }).default({}),
  packs: z.array(z.string()).default([]),
}).default({});

export const worktreeBindingSchema = z.object({
  projectRoot: z.string(),
  worktreePath: z.string(),
  branch: z.string().optional(),
  baseRef: z.string().optional(),
  baseCommit: z.string().optional(),
});

export const verificationEvidenceSchema = z.object({
  id: z.string(),
  command: z.string(),
  exitCode: z.number(),
  durationMs: z.number(),
  outputDigest: z.string(),
  outputPreview: z.string(),
  diffDigest: z.string(),
  createdAt: z.string(),
  stale: z.boolean().default(false),
});

export const handoffSchema = z.object({
  completedWork: z.string().default(""),
  currentDiffDigest: z.string(),
  failedChecks: z.array(z.string()).default([]),
  nextAction: z.string().default(""),
  unresolvedAssumptions: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export const orchestrationRunSchema = z.object({
  id: z.string(),
  goal: z.string(),
  scope: z.array(z.string()),
  workflow: orchestrationWorkflowSchema,
  preset: z.enum(["coding", "lightweight"]).optional(),
  revision: z.number().int().nonnegative().default(0),
  contract: runContractSchema,
  worktree: worktreeBindingSchema.optional(),
  evidence: z.array(verificationEvidenceSchema).default([]),
  handoff: handoffSchema.optional(),
  status: orchestrationRunStatusSchema,
  steps: z.array(orchestrationStepSchema),
  activeStepId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  canceledAt: z.string().optional(),
  note: z.string().optional(),
});

export const orchestrationEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string().optional(),
  type: z.string(),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  outcome: z.enum(["ok", "error", "denied"]).optional(),
  errorCategory: z.string().optional(),
  createdAt: z.string(),
});

export type OrchestrationWorkflow = z.infer<typeof orchestrationWorkflowSchema>;
export type OrchestrationRunStatus = z.infer<typeof orchestrationRunStatusSchema>;
export type OrchestrationStepStatus = z.infer<typeof orchestrationStepStatusSchema>;
export type OrchestrationStepKind = z.infer<typeof orchestrationStepKindSchema>;
export type OrchestrationRole = z.infer<typeof orchestrationRoleSchema>;
export type OrchestrationStep = z.infer<typeof orchestrationStepSchema>;
export type OrchestrationRun = z.infer<typeof orchestrationRunSchema>;
export type OrchestrationEvent = z.infer<typeof orchestrationEventSchema>;
export type RunContract = z.infer<typeof runContractSchema>;
export type WorktreeBinding = z.infer<typeof worktreeBindingSchema>;
export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;
export type Handoff = z.infer<typeof handoffSchema>;
