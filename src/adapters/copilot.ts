import * as fs from "node:fs";
import { evaluate } from "../core/gate";

const EXIT_ALLOW = 0;
const EXIT_DENY = 2;

/**
 * VERIFY: GitHub Copilot instructions / hook surface is not confirmed in v0.2.
 * Best-effort stub mirroring codex adapter; commit-only enforcement is likely until verified.
 */
interface CopilotHookPayload {
  file?: string;
  file_path?: string;
  command?: string;
}

function readStdin(): string {
  return fs.readFileSync(0, "utf8");
}

function parsePayload(raw: string): CopilotHookPayload {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  return {
    file: typeof record.file === "string" ? record.file : undefined,
    file_path: typeof record.file_path === "string" ? record.file_path : undefined,
    command: typeof record.command === "string" ? record.command : undefined,
  };
}

export function runCopilotAdapter(harnessDir: string): void {
  const raw = readStdin();
  if (!raw.trim()) {
    process.exit(EXIT_ALLOW);
  }

  let payload: CopilotHookPayload;
  try {
    payload = parsePayload(raw);
  } catch {
    process.stderr.write("contextpilot gate: invalid Copilot hook JSON (VERIFY contract)\n");
    process.exit(EXIT_DENY);
  }

  const file = payload.file ?? payload.file_path;
  const result = file
    ? evaluate(harnessDir, { file })
    : payload.command
      ? evaluate(harnessDir, { command: payload.command })
      : evaluate(harnessDir, {});

  if (result.decision === "deny") {
    process.stderr.write(`${result.reason}\n`);
    process.exit(EXIT_DENY);
  }
  process.exit(EXIT_ALLOW);
}
