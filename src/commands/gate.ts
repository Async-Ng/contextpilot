import { execSync } from "node:child_process";
import type { AgentName } from "../core/config";
import { evaluate } from "../core/gate";
import {
  printGateInstallSummary,
  runGateInstall,
  type GateInstallOptions,
} from "../core/hook-install";
import {
  EXIT_GENERAL,
  EXIT_OK,
  errOut,
  exitMissingFlag,
  requireHarness,
} from "../core/io";
import { listOpenDecisions } from "../core/decisions";
import { runClaudeAdapter } from "../adapters/claude";
import { runCodexAdapter } from "../adapters/codex";
import { runCopilotAdapter } from "../adapters/copilot";
import { runCursorAdapter } from "../adapters/cursor";

const GATE_AGENTS = ["claude", "cursor", "codex", "copilot"] as const;
type GateAgentName = (typeof GATE_AGENTS)[number];

function isGateAgent(agent: string): agent is GateAgentName {
  return (GATE_AGENTS as readonly string[]).includes(agent);
}

function runAdapter(agent: GateAgentName, harnessDir: string): void {
  switch (agent) {
    case "claude":
      runClaudeAdapter(harnessDir);
      break;
    case "cursor":
      runCursorAdapter(harnessDir);
      break;
    case "codex":
      runCodexAdapter(harnessDir);
      break;
    case "copilot":
      runCopilotAdapter(harnessDir);
      break;
    default: {
      const _exhaustive: never = agent;
      return _exhaustive;
    }
  }
}

export interface GateCheckOptions {
  agent?: string;
}

export interface GateInstallCommandOptions {
  agent?: string;
  noGit?: boolean;
}

/**
 * `gate check --agent <name>` â€” read stdin, delegate to the agent adapter.
 */
export function runGateCheck(opts: GateCheckOptions): void {
  const harnessDir = requireHarness();

  if (!opts.agent) {
    exitMissingFlag(
      "--agent",
      "Specify agent: claude, cursor, codex, or copilot.",
    );
  }

  if (!isGateAgent(opts.agent)) {
    errOut(
      `Unknown agent "${opts.agent}". Supported: ${GATE_AGENTS.join(", ")}.`,
      { error: "unknown_agent", agent: opts.agent, supported: GATE_AGENTS },
    );
    process.exit(EXIT_GENERAL);
  }

  runAdapter(opts.agent, harnessDir);
}

/**
 * `gate precommit` â€” evaluate staged files; block on open discussion or gated scopes.
 */
export function runGatePrecommit(): void {
  const harnessDir = requireHarness();

  const open = listOpenDecisions(harnessDir);
  if (open.length > 0) {
    const first = open[0];
    if (first) {
      const reason =
        `Commit blocked: open discussion (${first.id}): "${first.question}". ` +
        `Resolve with: contextpilot decision resolve --id ${first.id} --resolution "<answer>" --json`;
      errOut(reason, {
        error: "open_discussion",
        id: first.id,
        question: first.question,
        blocked: true,
      });
      process.exit(EXIT_GENERAL);
    }
  }

  let stagedFiles: string[];
  try {
    const output = execSync("git diff --cached --name-only", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    stagedFiles = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errOut(`git diff --cached failed: ${message}`, {
      error: "git_diff_failed",
      message,
    });
    process.exit(EXIT_GENERAL);
  }

  for (const file of stagedFiles) {
    const result = evaluate(harnessDir, { file });
    if (result.decision === "deny") {
      errOut(`Commit blocked: ${result.reason}`, {
        error: "gate_deny",
        file,
        reason: result.reason,
        blocked: true,
      });
      process.exit(EXIT_GENERAL);
    }
  }

  process.exit(EXIT_OK);
}

/**
 * `gate install [--agent] [--no-git]` â€” deep-merge hooks and print enforcement table.
 */
export function runGateInstallCommand(opts: GateInstallCommandOptions): void {
  const harnessDir = requireHarness();

  const installOpts: GateInstallOptions = {
    noGit: opts.noGit ?? false,
  };

  if (opts.agent) {
    const agent = opts.agent as AgentName;
    installOpts.agent = agent;
  }

  const result = runGateInstall(harnessDir, installOpts);
  printGateInstallSummary(result);
}
