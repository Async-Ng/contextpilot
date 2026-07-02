import { z } from "zod";

export const learningCategorySchema = z.enum([
  "mistake",
  "constraint",
  "gotcha",
  "decision",
]);
export const learningSeveritySchema = z.enum(["low", "med", "high"]);
export const learningStatusSchema = z.enum(["active", "archived"]);

export const learningSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  category: learningCategorySchema,
  severity: learningSeveritySchema,
  title: z.string(),
  detail: z.string(),
  scope: z.array(z.string()),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  status: learningStatusSchema,
  sourceItemId: z.string().optional(),
});

export type Learning = z.infer<typeof learningSchema>;
export type LearningCategory = z.infer<typeof learningCategorySchema>;
export type LearningSeverity = z.infer<typeof learningSeveritySchema>;

export const SEVERITY_ORDER: Record<LearningSeverity, number> = {
  high: 0,
  med: 1,
  low: 2,
};
