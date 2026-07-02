import * as fs from "node:fs";
import * as path from "node:path";
import {
  defaultConfig,
  defaultGateConfig,
  defaultOrchestrationConfig,
  gateConfigSchema,
  harnessConfigSchema,
  type GateConfig,
  type HarnessConfig,
  orchestrationConfigSchema,
  type OrchestrationConfig,
} from "./config";
import { writeAtomic } from "./io";

export function configPath(harnessDir: string): string {
  return path.join(harnessDir, "harness.config.json");
}

function mergeGateConfig(raw: unknown): GateConfig {
  if (raw === undefined || raw === null) {
    return defaultGateConfig();
  }
  const partial = gateConfigSchema.partial().parse(raw);
  return gateConfigSchema.parse({ ...defaultGateConfig(), ...partial });
}

function mergeOrchestrationConfig(raw: unknown): OrchestrationConfig {
  if (raw === undefined || raw === null) {
    return defaultOrchestrationConfig();
  }
  const partial = orchestrationConfigSchema.partial().parse(raw);
  return orchestrationConfigSchema.parse({
    ...defaultOrchestrationConfig(),
    ...partial,
  });
}

function normalizeStoragePath(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/^\.harness(?=\/|\\|$)/, ".contextpilot");
}

function normalizeStoragePaths(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  for (const key of ["rulesDir", "contextFile", "memoryFile", "archiveFile", "stateFile"]) {
    next[key] = normalizeStoragePath(next[key]);
  }
  if (typeof next.gate === "object" && next.gate !== null && !Array.isArray(next.gate)) {
    const gate = { ...(next.gate as Record<string, unknown>) };
    gate.decisionsFile = normalizeStoragePath(gate.decisionsFile);
    next.gate = gate;
  }
  if (
    typeof next.orchestration === "object" &&
    next.orchestration !== null &&
    !Array.isArray(next.orchestration)
  ) {
    const orchestration = { ...(next.orchestration as Record<string, unknown>) };
    orchestration.runsFile = normalizeStoragePath(orchestration.runsFile);
    orchestration.eventsFile = normalizeStoragePath(orchestration.eventsFile);
    next.orchestration = orchestration;
  }
  return next;
}

function normalizeConfig(raw: unknown): HarnessConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return harnessConfigSchema.parse(defaultConfig());
  }
  const record = normalizeStoragePaths(raw as Record<string, unknown>);
  const defaults = defaultConfig();
  const merged: Record<string, unknown> = {
    ...defaults,
    ...record,
    gate: mergeGateConfig(record.gate),
    orchestration: mergeOrchestrationConfig(record.orchestration),
  };
  if (typeof record.agents === "undefined") {
    merged.agents = defaults.agents;
  }
  if (typeof record.targets === "object" && record.targets !== null) {
    merged.targets = { ...defaults.targets, ...record.targets };
  }
  if (typeof record.scan === "object" && record.scan !== null) {
    merged.scan = { ...defaults.scan, ...record.scan };
  }
  if (typeof record.discover === "object" && record.discover !== null) {
    merged.discover = { ...defaults.discover, ...record.discover };
  }
  if (typeof record.srs === "object" && record.srs !== null) {
    merged.srs = { ...defaults.srs, ...record.srs };
  }
  return harnessConfigSchema.parse(merged);
}

export function loadConfig(harnessDir: string): HarnessConfig {
  const raw: unknown = JSON.parse(fs.readFileSync(configPath(harnessDir), "utf8"));
  return normalizeConfig(raw);
}

export function saveConfig(harnessDir: string, config: HarnessConfig): void {
  const validated = harnessConfigSchema.parse(config);
  writeAtomic(configPath(harnessDir), `${JSON.stringify(validated, null, 2)}\n`);
}

export function resolveProjectPath(harnessDir: string, relativePath: string): string {
  const projectRoot = path.dirname(harnessDir);
  return path.join(projectRoot, relativePath);
}
