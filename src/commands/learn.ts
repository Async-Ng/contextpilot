import {
  learningCategorySchema,
  learningSeveritySchema,
} from "../core/learning-schema";
import { appendLearning } from "../core/memory";
import {
  EXIT_OK,
  exitMissingFlag,
  out,
  requireHarness,
} from "../core/io";

export interface LearnOptions {
  category?: string;
  severity?: string;
  title?: string;
  detail?: string;
  scope?: string;
  tags?: string;
  pin?: boolean;
}

export function runLearn(options: LearnOptions): void {
  const harnessDir = requireHarness();

  if (!options.category) {
    exitMissingFlag("--category", "e.g. --category mistake");
  }
  if (!options.severity) {
    exitMissingFlag("--severity", "e.g. --severity high");
  }
  if (!options.title) {
    exitMissingFlag("--title", "Short title for the learning");
  }
  if (!options.detail) {
    exitMissingFlag("--detail", "What happened and why");
  }

  const category = learningCategorySchema.safeParse(options.category);
  if (!category.success) {
    exitMissingFlag("--category", "Must be mistake|constraint|gotcha|decision");
  }
  const severity = learningSeveritySchema.safeParse(options.severity);
  if (!severity.success) {
    exitMissingFlag("--severity", "Must be low|med|high");
  }

  const scope = options.scope
    ? options.scope.split(",").map((s) => s.trim())
    : ["**/*"];
  const tags = options.tags
    ? options.tags.split(",").map((t) => t.trim())
    : [];

  const result = appendLearning(harnessDir, {
    category: category.data,
    severity: severity.data,
    title: options.title,
    detail: options.detail,
    scope,
    tags,
    pinned: options.pin ?? false,
  });

  out(
    result.status === "duplicate"
      ? `Duplicate learning (existing id: ${result.id})`
      : `Learning recorded: ${result.id}`,
    result,
  );
  process.exit(EXIT_OK);
}
