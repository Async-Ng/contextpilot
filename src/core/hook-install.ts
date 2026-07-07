import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentName } from "./config";
import { loadConfig } from "./config-io";
import { out, writeAtomic } from "./io";

const GIT_HOOK_MARKER = "# contextpilot gate precommit";
const LEGACY_GIT_HOOK_MARKER = "# agent-harness gate precommit";

export interface EnforcementTier {
  preBlock: boolean;
  revert: boolean;
  commitOnly: boolean;
}

export interface AgentInstallResult {
  agent: AgentName;
  installed: boolean;
  files: string[];
  enforcement: EnforcementTier;
  notes?: string;
}

export interface GateInstallResult {
  agents: AgentInstallResult[];
  gitHook: boolean;
}

export interface GateInstallOptions {
  agent?: AgentName | AgentName[];
  noGit?: boolean;
}

interface ClaudeHookCommand {
  type: "command";
  command: string;
}

interface ClaudeMatcherGroup {
  matcher?: string;
  hooks: ClaudeHookCommand[];
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeMatcherGroup[]>;
}

interface CursorHookEntry {
  command: string;
  type?: "command" | "prompt";
  matcher?: string;
  failClosed?: boolean;
  timeout?: number;
}

interface CursorHooksFile {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    return {};
  }
  return parsed;
}

function withoutLegacyClaudeCommands(settings: ClaudeSettings): ClaudeSettings {
  const hooks = settings.hooks;
  if (!hooks) {
    return settings;
  }
  const cleaned: Record<string, ClaudeMatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    cleaned[event] = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((hook) => !hook.command.includes("agent-harness")),
      }))
      .filter((group) => group.hooks.length > 0);
  }
  return { ...settings, hooks: cleaned };
}

function withoutLegacyCursorCommands(settings: CursorHooksFile): CursorHooksFile {
  const hooks = settings.hooks;
  if (!hooks) {
    return settings;
  }
  const cleaned: Record<string, CursorHookEntry[]> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    cleaned[event] = entries.filter((entry) => !entry.command.includes("agent-harness"));
  }
  return { ...settings, hooks: cleaned };
}

function mergeClaudeMatcherGroups(
  existing: ClaudeMatcherGroup[],
  incoming: ClaudeMatcherGroup[],
): ClaudeMatcherGroup[] {
  const merged = [...existing];
  for (const group of incoming) {
    const matcher = group.matcher ?? "";
    const idx = merged.findIndex((g) => (g.matcher ?? "") === matcher);
    if (idx === -1) {
      merged.push(group);
      continue;
    }
    const current = merged[idx];
    if (!current) {
      merged.push(group);
      continue;
    }
    const commands = new Set(current.hooks.map((h) => h.command));
    const newHooks = group.hooks.filter((h) => !commands.has(h.command));
    merged[idx] = { ...current, hooks: [...current.hooks, ...newHooks] };
  }
  return merged;
}

function mergeClaudeHooks(
  existing: ClaudeSettings,
  incoming: ClaudeSettings,
): ClaudeSettings {
  const result: ClaudeSettings = { hooks: { ...existing.hooks } };
  const incomingHooks = incoming.hooks ?? {};
  for (const [event, groups] of Object.entries(incomingHooks)) {
    const current = result.hooks?.[event] ?? [];
    const mergedGroups = mergeClaudeMatcherGroups(current, groups);
    result.hooks = { ...result.hooks, [event]: mergedGroups };
  }
  return result;
}

function mergeCursorHookEntries(
  existing: CursorHookEntry[],
  incoming: CursorHookEntry[],
): CursorHookEntry[] {
  const commands = new Set(existing.map((e) => e.command));
  const appended = incoming.filter((e) => !commands.has(e.command));
  return [...existing, ...appended];
}

function mergeCursorHooks(
  existing: CursorHooksFile,
  incoming: CursorHooksFile,
): CursorHooksFile {
  const result: CursorHooksFile = {
    version: incoming.version ?? existing.version ?? 1,
    hooks: { ...existing.hooks },
  };
  const incomingHooks = incoming.hooks ?? {};
  for (const [event, entries] of Object.entries(incomingHooks)) {
    const current = result.hooks?.[event] ?? [];
    const merged = mergeCursorHookEntries(current, entries);
    result.hooks = { ...result.hooks, [event]: merged };
  }
  return result;
}

/** Resolve CLI prefix for hook commands: local node_modules, dev dist, or npx. */
export function resolveHarnessCommand(projectRoot: string): string {
  const candidates = [
    path.join(projectRoot, "node_modules", "contextpilot", "dist", "index.js"),
    path.join(
      projectRoot,
      "node_modules",
      "@async-nguyen",
      "contextpilot",
      "dist",
      "index.js",
    ),
  ];
  for (const pkgDist of candidates) {
    if (fs.existsSync(pkgDist)) {
      return `node "${pkgDist.replace(/\\/g, "/")}"`;
    }
  }

  const localDist = path.resolve(__dirname, "..", "index.js");
  const localPkg = path.resolve(__dirname, "..", "..", "package.json");
  if (fs.existsSync(localDist) && fs.existsSync(localPkg)) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(localPkg, "utf8"));
      if (
        isPlainObject(raw) &&
        raw.name === "contextpilot"
      ) {
        return `node "${localDist.replace(/\\/g, "/")}"`;
      }
    } catch {
      // fall through to npx
    }
  }

  return "npx --no-install contextpilot";
}

function harnessSubcommand(projectRoot: string, subcommand: string): string {
  return `${resolveHarnessCommand(projectRoot)} ${subcommand}`;
}

function installClaudeHooks(
  projectRoot: string,
  toolsMatcher: string,
): { file: string; enforcement: EnforcementTier } {
  const file = path.join(projectRoot, ".claude", "settings.json");
  const cli = resolveHarnessCommand(projectRoot);
  const gateCheck = `${cli} gate check --agent claude`;
  const contextInject = `${cli} context --inject`;
  const checkpoint = `${cli} checkpoint`;

  const incoming: ClaudeSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: toolsMatcher,
          hooks: [{ type: "command", command: gateCheck }],
        },
      ],
      SessionStart: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: contextInject }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: "command", command: checkpoint }],
        },
      ],
    },
  };

  const existing = withoutLegacyClaudeCommands(readJsonFile(file) as ClaudeSettings);
  const merged = mergeClaudeHooks(existing, incoming);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify(merged, null, 2)}\n`);

  return {
    file,
    enforcement: { preBlock: true, revert: false, commitOnly: false },
  };
}

function installCursorHooks(
  projectRoot: string,
): { file: string; enforcement: EnforcementTier } {
  const file = path.join(projectRoot, ".cursor", "hooks.json");
  const gateCheck = harnessSubcommand(projectRoot, "gate check --agent cursor");
  const contextInject = harnessSubcommand(projectRoot, "context --inject");
  const checkpoint = harnessSubcommand(projectRoot, "checkpoint");

  const gateEntry: CursorHookEntry = { command: gateCheck, failClosed: true };
  const incoming: CursorHooksFile = {
    version: 1,
    hooks: {
      beforeShellExecution: [gateEntry],
      beforeMCPExecution: [{ command: gateCheck, failClosed: true }],
      afterFileEdit: [{ command: gateCheck, failClosed: true }],
      sessionStart: [{ command: contextInject }],
      beforeSubmitPrompt: [{ command: contextInject }],
      stop: [{ command: checkpoint }],
    },
  };

  const existing = withoutLegacyCursorCommands(readJsonFile(file) as CursorHooksFile);
  const merged = mergeCursorHooks(existing, incoming);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify(merged, null, 2)}\n`);

  return {
    file,
    enforcement: { preBlock: true, revert: true, commitOnly: false },
  };
}

function installCodexHooks(
  projectRoot: string,
  toolsMatcher: string,
): { files: string[]; enforcement: EnforcementTier; notes: string } {
  const hooksFile = path.join(projectRoot, ".codex", "hooks.json");
  const configFile = path.join(projectRoot, ".codex", "config.toml");
  const cli = resolveHarnessCommand(projectRoot);
  const gateCheck = `${cli} gate check --agent codex`;
  const contextInject = `${cli} context --inject`;
  const checkpoint = `${cli} checkpoint`;

  const incoming: ClaudeSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: toolsMatcher,
          hooks: [{ type: "command", command: gateCheck }],
        },
      ],
      SessionStart: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: contextInject }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: "command", command: checkpoint }],
        },
      ],
    },
  };

  const existing = withoutLegacyClaudeCommands(readJsonFile(hooksFile) as ClaudeSettings);
  const merged = mergeClaudeHooks(existing, incoming);
  fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
  writeAtomic(hooksFile, `${JSON.stringify(merged, null, 2)}\n`);

  const files = [hooksFile];
  let notes =
    "VERIFY: Codex hooks are experimental; enable [features] codex_hooks = true in config.toml. Not available on Windows.";

  if (!fs.existsSync(configFile)) {
    const toml = `[features]\ncodex_hooks = true\n`;
    writeAtomic(configFile, toml);
    files.push(configFile);
  } else {
    const content = fs.readFileSync(configFile, "utf8");
    if (!content.includes("codex_hooks")) {
      const separator = content.endsWith("\n") ? "" : "\n";
      writeAtomic(configFile, `${content}${separator}\n[features]\ncodex_hooks = true\n`);
      files.push(configFile);
    }
  }

  return {
    files,
    enforcement: { preBlock: true, revert: false, commitOnly: false },
    notes,
  };
}

function installGitPrecommit(projectRoot: string): boolean {
  const gitDir = path.join(projectRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    return false;
  }

  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  const gateLine = `${resolveHarnessCommand(projectRoot)} gate precommit`;

  let existing = "";
  if (fs.existsSync(hookPath)) {
    existing = fs.readFileSync(hookPath, "utf8");
    if (existing.includes(LEGACY_GIT_HOOK_MARKER)) {
      existing = existing.replace(
        /# agent-harness gate precommit\r?\n.*agent-harness gate precommit.*(?:\r?\n){1,2}/g,
        "",
      );
    }
    if (existing.includes(GIT_HOOK_MARKER)) {
      return true;
    }
  } else {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  }

  const shebang = existing.startsWith("#!") ? "" : "#!/bin/sh\n";
  const block = `${GIT_HOOK_MARKER}\n${gateLine} || exit 1\n\n`;
  fs.writeFileSync(hookPath, `${shebang}${block}${existing}`, { mode: 0o755 });
  return true;
}

function normalizeAgents(
  harnessDir: string,
  opts?: GateInstallOptions,
): AgentName[] {
  if (opts?.agent) {
    return Array.isArray(opts.agent) ? opts.agent : [opts.agent];
  }
  return loadConfig(harnessDir).agents;
}

function installAgent(
  agent: AgentName,
  projectRoot: string,
  toolsMatcher: string,
): AgentInstallResult {
  switch (agent) {
    case "claude": {
      const { file, enforcement } = installClaudeHooks(projectRoot, toolsMatcher);
      return { agent, installed: true, files: [file], enforcement };
    }
    case "cursor": {
      const { file, enforcement } = installCursorHooks(projectRoot);
      return { agent, installed: true, files: [file], enforcement };
    }
    case "codex": {
      const { files, enforcement, notes } = installCodexHooks(projectRoot, toolsMatcher);
      return { agent, installed: true, files, enforcement, notes };
    }
    case "copilot":
      return {
        agent,
        installed: false,
        files: [],
        enforcement: { preBlock: false, revert: false, commitOnly: true },
        notes: "VERIFY: No Copilot hook API confirmed in v0.2 - git pre-commit backstop only.",
      };
    case "windsurf":
      return {
        agent,
        installed: false,
        files: [],
        enforcement: { preBlock: false, revert: false, commitOnly: true },
        notes: "Windsurf hook install not supported in v0.2 - git pre-commit backstop only.",
      };
    default: {
      const _exhaustive: never = agent;
      return _exhaustive;
    }
  }
}

function formatEnforcementTable(results: AgentInstallResult[], gitHook: boolean): string {
  const lines = [
    "",
    "Enforcement tiers:",
    "  Agent      | Pre-block | Revert | Commit-only",
    "  -----------|-----------|--------|------------",
  ];

  for (const r of results) {
    const name = r.agent.padEnd(10);
    const pre = r.enforcement.preBlock ? "yes" : "no";
    const rev = r.enforcement.revert ? "yes" : "no";
    const commit = r.enforcement.commitOnly ? "yes" : "no";
    lines.push(`  ${name} | ${pre.padEnd(9)} | ${rev.padEnd(6)} | ${commit}`);
    if (r.notes) {
      lines.push(`             ${r.notes}`);
    }
  }

  lines.push(`  git        | no        | no     | ${gitHook ? "yes (pre-commit)" : "no"}`);
  return lines.join("\n");
}

/**
 * Deep-merge agent hook configs and optionally install git pre-commit backstop.
 */
export function runGateInstall(
  harnessDir: string,
  opts?: GateInstallOptions,
): GateInstallResult {
  const projectRoot = path.dirname(harnessDir);
  const config = loadConfig(harnessDir);
  const agents = normalizeAgents(harnessDir, opts);
  const agentResults = agents.map((agent) =>
    installAgent(agent, projectRoot, config.gate.toolsMatcher),
  );

  const gitHook = opts?.noGit ? false : installGitPrecommit(projectRoot);

  return { agents: agentResults, gitHook };
}

export function printGateInstallSummary(result: GateInstallResult): void {
  const installed = result.agents.filter((a) => a.installed);
  const skipped = result.agents.filter((a) => !a.installed);

  const humanParts: string[] = [];
  if (installed.length > 0) {
    humanParts.push(
      `Installed hooks for: ${installed.map((a) => a.agent).join(", ")}`,
    );
    for (const a of installed) {
      humanParts.push(`  ${a.agent}: ${a.files.join(", ")}`);
    }
  }
  if (skipped.length > 0) {
    humanParts.push(`Skipped (commit-only): ${skipped.map((a) => a.agent).join(", ")}`);
  }
  if (result.gitHook) {
    humanParts.push("Git pre-commit backstop installed.");
  } else {
    humanParts.push("Git pre-commit backstop not installed.");
  }
  humanParts.push(formatEnforcementTable(result.agents, result.gitHook));

  out(humanParts.join("\n"), {
    status: "gate_installed",
    agents: result.agents,
    gitHook: result.gitHook,
  });
}
