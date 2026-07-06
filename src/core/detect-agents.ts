import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import type { AgentName } from "./config";

const DETECTION_ORDER: AgentName[] = [
  "claude",
  "cursor",
  "codex",
  "copilot",
  "windsurf",
];

/**
 * Heuristic scan for agent tooling markers in a project root.
 * Checks .claude/, .cursor/, AGENTS.md, copilot-instructions, .windsurf/.
 */
export function detectAgents(projectRoot: string): AgentName[] {
  const detected = new Set<AgentName>();

  if (fs.existsSync(path.join(projectRoot, ".claude"))) {
    detected.add("claude");
  }

  if (fs.existsSync(path.join(projectRoot, ".cursor"))) {
    detected.add("cursor");
  }

  const agentsMdMatches = fg.sync(["AGENTS.md", "**/AGENTS.md"], {
    cwd: projectRoot,
    onlyFiles: true,
    suppressErrors: true,
    ignore: ["node_modules/**", ".contextpilot/**", "dist/**"],
  });
  if (agentsMdMatches.length > 0) {
    detected.add("codex");
  }

  const copilotInstructions = path.join(
    projectRoot,
    ".github",
    "copilot-instructions.md",
  );
  const copilotInstructionsDir = path.join(
    projectRoot,
    ".github",
    "instructions",
  );
  if (
    fs.existsSync(copilotInstructions) ||
    fs.existsSync(copilotInstructionsDir)
  ) {
    detected.add("copilot");
  }

  if (fs.existsSync(path.join(projectRoot, ".windsurf"))) {
    detected.add("windsurf");
  }

  // AGENTS.md is the universal agent context file - always sync it.
  detected.add("codex");

  return DETECTION_ORDER.filter((agent) => detected.has(agent));
}
