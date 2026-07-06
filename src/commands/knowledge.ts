import chalk from "chalk";
import {
  getKnowledgeById,
  queryKnowledge,
  type KnowledgeQueryResult,
  type KnowledgeResult,
} from "../core/knowledge";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";

export interface KnowledgeQueryCommandOptions {
  query?: string;
  file?: string[];
  scope?: string;
  target?: string;
  limit?: string;
  includeBody?: boolean;
}

export interface KnowledgeRelevantCommandOptions {
  file?: string[];
  target?: string;
  limit?: string;
}

function parseLimit(value: string | undefined): number {
  if (!value) {
    return 10;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return parsed;
}

function parseScopes(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function formatResultLine(result: KnowledgeResult): string {
  return [
    chalk.bold(result.id),
    `[score ${result.score}]`,
    result.title,
    `scope: ${result.scope.join(", ")}`,
    `source: ${result.source}`,
  ].join(" - ");
}

function humanSummary(result: KnowledgeQueryResult): string {
  if (result.results.length === 0) {
    return "No matching knowledge found.";
  }
  return result.results.map(formatResultLine).join("\n");
}

export function runKnowledgeQuery(options: KnowledgeQueryCommandOptions): void {
  const harnessDir = requireHarness();
  try {
    const result = queryKnowledge(harnessDir, {
      query: options.query,
      files: options.file ?? [],
      scopes: parseScopes(options.scope),
      target: options.target,
      limit: parseLimit(options.limit),
      includeBody: options.includeBody ?? false,
    });
    out(humanSummary(result), result);
    process.exit(EXIT_OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errOut(`Knowledge query failed: ${message}`, {
      error: "knowledge_query_failed",
      message,
    });
    process.exit(EXIT_GENERAL);
  }
}

export function runKnowledgeRelevant(options: KnowledgeRelevantCommandOptions): void {
  const harnessDir = requireHarness();
  try {
    const files = options.file ?? [];
    if (files.length === 0) {
      throw new Error("At least one --file value is required.");
    }
    const result = queryKnowledge(harnessDir, {
      files,
      target: options.target,
      limit: parseLimit(options.limit),
      includeBody: false,
    });
    out(humanSummary(result), result);
    process.exit(EXIT_OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errOut(`Knowledge relevant failed: ${message}`, {
      error: "knowledge_relevant_failed",
      message,
    });
    process.exit(EXIT_GENERAL);
  }
}

export function runKnowledgeShow(id: string): void {
  const harnessDir = requireHarness();
  const result = getKnowledgeById(harnessDir, id);
  if (!result) {
    errOut(`Knowledge item not found: ${id}`, {
      error: "knowledge_not_found",
      id,
    });
    process.exit(EXIT_GENERAL);
  }
  out(result.body ?? "", result);
  process.exit(EXIT_OK);
}
