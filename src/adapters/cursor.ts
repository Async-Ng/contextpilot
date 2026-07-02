import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { evaluate } from "../core/gate";

const EXIT_ALLOW = 0;
const EXIT_DENY = 2;

interface CursorPermissionResponse {
  permission: "allow" | "deny";
  agentMessage?: string;
}

interface CursorHookPayload {
  command?: string;
  file?: string;
  file_path?: string;
  path?: string;
}

function readStdin(): string {
  return fs.readFileSync(0, "utf8");
}

function parsePayload(raw: string): CursorHookPayload {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  return {
    command: typeof record.command === "string" ? record.command : undefined,
    file: typeof record.file === "string" ? record.file : undefined,
    file_path: typeof record.file_path === "string" ? record.file_path : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
  };
}

function resolveFile(payload: CursorHookPayload): string | undefined {
  return payload.file ?? payload.file_path ?? payload.path;
}

function emitPermission(response: CursorPermissionResponse, exitCode: number): never {
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exit(exitCode);
}

function revertFile(file: string): void {
  try {
    execSync(`git checkout -- ${JSON.stringify(file)}`, { stdio: "pipe" });
  } catch {
    process.stderr.write(`contextpilot gate: git checkout failed for ${file}\n`);
  }
}

/**
 * Cursor hooks adapter: beforeShellExecution / beforeMCPExecution (command) and afterFileEdit (file).
 * Pre-block deny: JSON permission deny + exit 2. afterFileEdit deny: git checkout + deny JSON.
 */
export function runCursorAdapter(harnessDir: string): void {
  const raw = readStdin();
  if (!raw.trim()) {
    emitPermission({ permission: "allow" }, EXIT_ALLOW);
  }

  let payload: CursorHookPayload;
  try {
    payload = parsePayload(raw);
  } catch {
    emitPermission(
      { permission: "deny", agentMessage: "contextpilot gate: invalid Cursor hook JSON" },
      EXIT_DENY,
    );
  }

  const file = resolveFile(payload);
  const command = payload.command;

  const result = file
    ? evaluate(harnessDir, { file })
    : command
      ? evaluate(harnessDir, { command })
      : evaluate(harnessDir, {});

  if (result.decision === "deny") {
    if (file) {
      revertFile(file);
    }
    emitPermission({ permission: "deny", agentMessage: result.reason }, file ? EXIT_ALLOW : EXIT_DENY);
  }

  emitPermission({ permission: "allow" }, EXIT_ALLOW);
}
