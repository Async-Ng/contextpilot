import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentName, HarnessConfig } from "../core/config";
import { loadConfig, saveConfig } from "../core/config-io";
import { detectAgents } from "../core/detect-agents";
import { getGlobalOptions } from "../core/globals";
import { runGateInstall, type GateInstallResult } from "../core/hook-install";
import {
  EXIT_GENERAL,
  EXIT_OK,
  errOut,
  getHarnessDir,
  getLegacyHarnessDir,
  out,
} from "../core/io";
import { ingestSrs, type IngestResult } from "../core/srs";
import { setSrsState } from "../core/srs-state";
import { runSync } from "../core/sync";
import {
  autoAdoptDiscoverItems,
  DEFAULT_AGENTS,
  scaffoldHarness,
} from "./init";

const SUPPORTED_AGENTS: AgentName[] = [
  "claude",
  "cursor",
  "codex",
  "windsurf",
  "copilot",
];

export interface SetupOptions {
  agent?: string;
  noGit?: boolean;
}

interface SetupResult {
  status: "setup";
  mode: "fresh" | "existing";
  harnessDir: string;
  migratedFrom?: string;
  agents: AgentName[];
  gate: GateInstallResult;
  srs: IngestResult | null;
  discover: { adoptedCount: number; skillsSeen: number } | null;
  synced: Awaited<ReturnType<typeof runSync>>;
  message: string;
}

function parseAgent(agent?: string): AgentName | undefined {
  if (!agent) return undefined;
  if ((SUPPORTED_AGENTS as string[]).includes(agent)) {
    return agent as AgentName;
  }
  errOut(`Unknown agent "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}.`, {
    error: "unknown_agent",
    agent,
    supported: SUPPORTED_AGENTS,
  });
  process.exit(EXIT_GENERAL);
}

function chooseAgents(cwd: string, requested?: AgentName): AgentName[] {
  if (requested) {
    return [requested];
  }
  const detected = detectAgents(cwd);
  return detected.filter((a) => a !== "codex").length > 0
    ? detected
    : DEFAULT_AGENTS;
}

function mergeAgent(config: HarnessConfig, agent?: AgentName): HarnessConfig {
  if (!agent || config.agents.includes(agent)) {
    return config;
  }
  return { ...config, agents: [...config.agents, agent] };
}

function configExists(harnessDir: string): boolean {
  return fs.existsSync(path.join(harnessDir, "harness.config.json"));
}

function migrateLegacyHarness(cwd: string, harnessDir: string): string | undefined {
  const legacyDir = getLegacyHarnessDir(cwd);
  if (fs.existsSync(harnessDir) || !configExists(legacyDir)) {
    return undefined;
  }

  fs.renameSync(legacyDir, harnessDir);
  const normalized = loadConfig(harnessDir);
  saveConfig(harnessDir, normalized);
  return legacyDir;
}

async function runFreshSetup(
  cwd: string,
  harnessDir: string,
  requestedAgent: AgentName | undefined,
  noGit: boolean,
): Promise<Omit<SetupResult, "status" | "message">> {
  const agents = chooseAgents(cwd, requestedAgent);
  const config = scaffoldHarness(harnessDir, cwd, agents);
  const gate = runGateInstall(harnessDir, {
    agent: agents,
    noGit,
  });

  let srs: IngestResult | null = null;
  const srsDir = path.join(cwd, config.srs.path);
  if (fs.existsSync(srsDir)) {
    srs = await ingestSrs(harnessDir);
  } else if (config.srs.requiredForGreenfield) {
    await setSrsState(harnessDir, "missing", config.srs.bootstrapPath);
  }

  const discover = await autoAdoptDiscoverItems(harnessDir);
  const synced = await runSync(harnessDir);

  return {
    mode: "fresh",
    harnessDir,
    agents,
    gate,
    srs,
    discover,
    synced,
  };
}

async function runExistingSetup(
  harnessDir: string,
  requestedAgent: AgentName | undefined,
  noGit: boolean,
  migratedFrom?: string,
): Promise<Omit<SetupResult, "status" | "message">> {
  const config = mergeAgent(loadConfig(harnessDir), requestedAgent);
  saveConfig(harnessDir, config);

  const agents = requestedAgent ? [requestedAgent] : config.agents;
  const gate = runGateInstall(harnessDir, {
    agent: agents,
    noGit,
  });
  const synced = await runSync(harnessDir);

  return {
    mode: "existing",
    harnessDir,
    migratedFrom,
    agents: config.agents,
    gate,
    srs: null,
    discover: null,
    synced,
  };
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const cwd = getGlobalOptions().cwd;
  const harnessDir = getHarnessDir(cwd);
  const migratedFrom = migrateLegacyHarness(cwd, harnessDir);
  const requestedAgent = parseAgent(options.agent);
  const noGit = options.noGit ?? false;

  try {
    const base = configExists(harnessDir)
      ? await runExistingSetup(harnessDir, requestedAgent, noGit, migratedFrom)
      : await runFreshSetup(cwd, harnessDir, requestedAgent, noGit);

    const result: SetupResult = {
      status: "setup",
      ...base,
      message: "Setup complete. Now chat with your AI agent normally.",
    };

    out(result.message, result);
    process.exit(EXIT_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errOut(`Setup failed: ${message}`, {
      error: "setup_failed",
      message,
    });
    process.exit(EXIT_GENERAL);
  }
}
