import type { HarnessConfig } from "./config";
import type { Rule } from "./rules";

const KEY_ID_PATTERN =
  /\b(NFR-\d+|SR-\d+|ERR-\d+|AC-\d+|BR-[A-Z]+-\d+|FR-[A-Z]+-\d+)\b/g;

function extractKeyIds(body: string, max = 5): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of body.matchAll(KEY_ID_PATTERN)) {
    const id = match[0];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= max) break;
  }
  return ids;
}

/**
 * Build a compact summary table for global SRS knowledge (sections 01-11, all files).
 * Used in Cursor _project.mdc and single-file agent targets instead of full inline prose.
 */
export function buildGlobalKnowledgeSummary(
  config: HarnessConfig,
  globalRules: Rule[],
): string {
  if (globalRules.length === 0) {
    return "";
  }

  const maxChars = config.agentContext.globalSummaryMaxChars;
  const lines: string[] = [
    "# Global SRS Summary",
    "",
    "Agent files contain summaries only. Load full text on demand:",
    "`contextpilot knowledge show <id>`",
    "",
    "| ID | Section | Title | Key IDs |",
    "| --- | --- | --- | --- |",
  ];

  for (const rule of globalRules) {
    const keyIds = extractKeyIds(rule.body).join(", ") || "(see full doc)";
    lines.push(
      `| ${rule.id} | ${rule.section ?? "-"} | ${rule.title} | ${keyIds} |`,
    );
  }

  const table = lines.join("\n");
  if (table.length > maxChars) {
    const header = lines.slice(0, 7);
    if (header.join("\n").length > maxChars) return "";
    const kept = [...header];
    const notice = "More entries: use `knowledge show <id>`.";
    for (const line of lines.slice(7)) {
      if ([...kept, line, "", notice].join("\n").length > maxChars) break;
      kept.push(line);
    }
    return [...kept, "", notice].join("\n").length <= maxChars
      ? [...kept, "", notice].join("\n")
      : kept.join("\n");
  }

  return table;
}
