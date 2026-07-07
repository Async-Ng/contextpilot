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

function normalizeExcerpt(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
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

  lines.push("");
  for (const rule of globalRules.slice(0, 3)) {
    const excerpt = normalizeExcerpt(rule.body, 120);
    if (excerpt) {
      lines.push(`- **${rule.id}**: ${excerpt}`);
    }
  }

  let content = lines.join("\n");
  if (content.length > maxChars) {
    content = `${content.slice(0, maxChars - 40).trimEnd()}\n\n...(truncated; use \`knowledge show <id>\`)\n`;
  }

  return content;
}
