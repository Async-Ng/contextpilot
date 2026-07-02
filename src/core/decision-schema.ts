import { z } from "zod";

export const decisionStatusSchema = z.enum(["open", "resolved", "rejected"]);

export const decisionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  status: decisionStatusSchema,
  question: z.string(),
  detail: z.string(),
  scopes: z.array(z.string()),
  sourceItemId: z.string().optional(),
  resolution: z.string().optional(),
  resolvedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
});

export type Decision = z.infer<typeof decisionSchema>;
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;
