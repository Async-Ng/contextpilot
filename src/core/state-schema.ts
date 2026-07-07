import { z } from "zod";

export const generatedEntrySchema = z.object({
  hash: z.string(),
  writtenAt: z.string(),
  sourceRuleId: z.string().optional(),
});

export const srsStatusSchema = z.enum(["missing", "bootstrapped", "ingested"]);

export const srsFileEntrySchema = z.object({
  hash: z.string(),
  ingestedAt: z.string(),
});

export const ruleFileEntrySchema = z.object({
  hash: z.string(),
  writtenAt: z.string(),
});

export const srsStateSchema = z
  .object({
    status: srsStatusSchema.optional(),
    path: z.string().optional(),
    updatedAt: z.string().optional(),
    files: z.record(srsFileEntrySchema).default({}),
  })
  .default({});

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
  srs: srsStateSchema,
  rules: z.record(ruleFileEntrySchema).default({}),
});

export type HarnessState = z.infer<typeof harnessStateSchema>;
export type GeneratedEntry = z.infer<typeof generatedEntrySchema>;
export type SrsStatus = z.infer<typeof srsStatusSchema>;
export type SrsState = z.infer<typeof srsStateSchema>;
export type SrsFileEntry = z.infer<typeof srsFileEntrySchema>;
export type RuleFileEntry = z.infer<typeof ruleFileEntrySchema>;

export function emptyState(): HarnessState {
  return { generated: {}, adopted: {}, skills: {}, orchestration: {}, srs: { files: {} }, rules: {} };
}
