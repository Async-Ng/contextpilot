import { z } from "zod";

export const ruleTypeSchema = z.enum(["rule", "knowledge"]);
export const prioritySchema = z.enum(["high", "normal", "low"]);

export const ruleOriginSchema = z.object({
  agent: z.string(),
  level: z.enum(["global", "project"]),
});

export const ruleFrontmatterSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  type: ruleTypeSchema.optional(),
  scope: z.array(z.string()).optional(),
  targets: z.array(z.string()).optional(),
  priority: prioritySchema.optional(),
  tags: z.array(z.string()).optional(),
  origin: ruleOriginSchema.optional(),
});

export type RuleFrontmatter = z.infer<typeof ruleFrontmatterSchema>;
export type RuleType = z.infer<typeof ruleTypeSchema>;
export type Priority = z.infer<typeof prioritySchema>;

export interface Rule {
  filePath: string;
  id: string;
  title: string;
  type: RuleType;
  scope: string[];
  targets: string[];
  priority: Priority;
  tags: string[];
  origin?: z.infer<typeof ruleOriginSchema>;
  body: string;
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};
