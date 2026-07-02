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
});

export const orchestrationRunSchema = z.object({
  id: z.string(),
  goal: z.string(),
  scope: z.array(z.string()),
  workflow: orchestrationWorkflowSchema,
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
