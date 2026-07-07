import type { AgentName } from "./config";
import type { KnowledgeResult } from "./knowledge";
import { matchesGlob } from "./gate";

export type ReadPolicy = "skip-body-read" | "knowledge-show-once" | "legacy-full" | "on-demand";

export interface ReadPolicyResult {
  policy: ReadPolicy;
  hint: string;
}

/**
 * Agent-aware read policy for knowledge results.
 * Cursor scoped rules already in context → skip re-read.
 * Single-file agents → use knowledge show once.
 */
export function resolveReadPolicy(
  agent: AgentName | string | undefined,
  filePath: string | undefined,
  knowledgeResults: KnowledgeResult[],
  options: { knowledgeMode?: "manifest" | "inline" } = {},
): ReadPolicyResult {
  if (options.knowledgeMode === "inline") {
    return {
      policy: "legacy-full",
      hint: "Inline knowledge mode: full SRS body is already in the agent file.",
    };
  }

  if (agent === "cursor" && filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const scopedMatch = knowledgeResults.some(
      (r) =>
        r.section &&
        !r.scope.includes("**/*") &&
        matchesGlob(normalized, r.scope),
    );
    if (scopedMatch) {
      return {
        policy: "skip-body-read",
        hint:
          "Scoped Cursor rules already match the edited path; do not re-read the same SRS body.",
      };
    }
  }

  if (knowledgeResults.length > 0) {
    const ids = knowledgeResults.slice(0, 2).map((r) => r.id).join(", ");
    return {
      policy: "knowledge-show-once",
      hint: `Load full body via \`contextpilot knowledge show <id>\` for: ${ids} (max 1-2 per task).`,
    };
  }

  return {
    policy: "on-demand",
    hint:
      "Run `contextpilot knowledge relevant --file \"<path>\" --task code --limit 2 --json` then `knowledge show <id>`.",
  };
}
