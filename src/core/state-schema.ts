import { z } from "zod";

export const generatedEntrySchema = z.object({
  hash: z.string(),
  writtenAt: z.string(),
  sourceRuleId: z.string().optional(),
});

export const harnessStateSchema = z.object({
  generated: z.record(generatedEntrySchema).default({}),
  adopted: z.record(z.string()).default({}),
  skills: z
    .record(
      z.object({
        level: z.enum(["project", "global"]),
        hash: z.string(),
      }),
    )
    .default({}),
  orchestration: z
    .object({
      activeRunId: z.string().optional(),
    })
    .default({}),
});

export type HarnessState = z.infer<typeof harnessStateSchema>;
export type GeneratedEntry = z.infer<typeof generatedEntrySchema>;

export function emptyState(): HarnessState {
  return { generated: {}, adopted: {}, skills: {}, orchestration: {} };
}
