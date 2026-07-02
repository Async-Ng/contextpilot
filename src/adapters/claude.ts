import * as fs from "node:fs";
import { evaluate } from "../core/gate";

const EXIT_ALLOW = 0;
const EXIT_DENY = 2;

interface ClaudeToolInput {
  file_path?: string;
}

interface ClaudeHookPayload {
  tool_input?: ClaudeToolInput;
}

function readStdin(): string {
  return fs.readFileSync(0, "utf8");
}

function parsePayload(raw: string): ClaudeHookPayload {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const toolInputRaw = record.tool_input;
  if (typeof toolInputRaw !== "object" || toolInputRaw === null || Array.isArray(toolInputRaw)) {
    return {};
  }
  const toolInput = toolInputRaw as Record<string, unknown>;
  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : undefined;
  return { tool_input: { file_path: filePath } };
}

/**
 * Claude Code PreToolUse hook adapter.
 * Deny: stderr reason, exit 2 (per Claude hooks docs).
 */
export function runClaudeAdapter(harnessDir: string): void {
  const raw = readStdin();
  if (!raw.trim()) {
    process.exit(EXIT_ALLOW);
  }

  let payload: ClaudeHookPayload;
  try {
    payload = parsePayload(raw);
  } catch {
    process.stderr.write("contextpilot gate: invalid Claude hook JSON\n");
    process.exit(EXIT_DENY);
  }

  const file = payload.tool_input?.file_path;
  const result = evaluate(harnessDir, file ? { file } : {});

  if (result.decision === "deny") {
    process.stderr.write(`${result.reason}\n`);
    process.exit(EXIT_DENY);
  }
  process.exit(EXIT_ALLOW);
}
