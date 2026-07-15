import * as fs from "node:fs";
import * as path from "node:path";
import {
  agentContextConfigSchema,
  defaultAgentContextConfig,
  defaultConfig,
  defaultGateConfig,
  defaultHooksConfig,
  defaultOrchestrationConfig,
  gateConfigSchema,
  harnessConfigSchema,
  hooksConfigSchema,
  type AgentContextConfig,
  type GateConfig,
  type HarnessConfig,
  type HooksConfig,
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

function mergeHooksConfig(raw: unknown): HooksConfig {
  if (raw === undefined || raw === null) {
    return defaultHooksConfig();
  }
  const partial = hooksConfigSchema.partial().parse(raw);
  return hooksConfigSchema.parse({ ...defaultHooksConfig(), ...partial });
}

function mergeAgentContextConfig(raw: unknown): AgentContextConfig {
  if (raw === undefined || raw === null) {
    return defaultAgentContextConfig();
  }
  const partial = agentContextConfigSchema.partial().parse(raw);
  return agentContextConfigSchema.parse({
    ...defaultAgentContextConfig(),
    ...partial,
  });
}

function normalizeStoragePath(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/^\.harness(?=\/|\\|$)/, ".contextpilot");
}

function normalizeSrsSkillPath(value: unknown): unknown {
  if (value === ".claude/skills/fullstack-to-srs") {
    return ".contextpilot/skills/fullstack-to-srs";
  }
  return normalizeStoragePath(value);
}

function normalizeStoragePaths(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  for (const key of ["rulesDir", "contextFile", "memoryFile", "archiveFile", "stateFile"]) {
    next[key] = normalizeStoragePath(next[key]);
  }
  if (
    typeof next.agentContext === "object" &&
    next.agentContext !== null &&
    !Array.isArray(next.agentContext)
  ) {
    const agentContext = { ...(next.agentContext as Record<string, unknown>) };
    agentContext.knowledgeIndexFile = normalizeStoragePath(agentContext.knowledgeIndexFile);
    next.agentContext = agentContext;
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
  if (typeof next.srs === "object" && next.srs !== null && !Array.isArray(next.srs)) {
    const srs = { ...(next.srs as Record<string, unknown>) };
    srs.skillPath = normalizeSrsSkillPath(srs.skillPath);
    next.srs = srs;
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
    agentContext: mergeAgentContextConfig(record.agentContext),
    gate: mergeGateConfig(record.gate),
    orchestration: mergeOrchestrationConfig(record.orchestration),
    hooks: mergeHooksConfig(record.hooks),
  };
  if (record.profile === "strict") {
    const agentContext = merged.agentContext as AgentContextConfig;
    const orchestration = merged.orchestration as OrchestrationConfig;
    const hooks = merged.hooks as HooksConfig;
    const gate = merged.gate as GateConfig;
    const rawAgentContext =
      typeof record.agentContext === "object" &&
      record.agentContext !== null &&
      !Array.isArray(record.agentContext)
        ? (record.agentContext as Record<string, unknown>)
        : {};
    const rawOrchestration =
      typeof record.orchestration === "object" &&
      record.orchestration !== null &&
      !Array.isArray(record.orchestration)
        ? (record.orchestration as Record<string, unknown>)
        : {};
    const rawHooks =
      typeof record.hooks === "object" &&
      record.hooks !== null &&
      !Array.isArray(record.hooks)
        ? (record.hooks as Record<string, unknown>)
        : {};
    const rawGate =
      typeof record.gate === "object" &&
      record.gate !== null &&
      !Array.isArray(record.gate)
        ? (record.gate as Record<string, unknown>)
        : {};
    merged.agentContext = {
      ...agentContext,
      protocolLevel:
        rawAgentContext.protocolLevel === undefined
          ? "standard"
          : agentContext.protocolLevel,
      globalKnowledgePolicy:
        rawAgentContext.globalKnowledgePolicy === undefined
          ? "summary"
          : agentContext.globalKnowledgePolicy,
    };
    merged.orchestration = {
      ...orchestration,
      autoStart:
        rawOrchestration.autoStart === undefined
          ? "always"
          : orchestration.autoStart,
    };
    merged.hooks = {
      ...hooks,
      infrastructureFailure:
        rawHooks.infrastructureFailure === undefined
          ? "fail-closed"
          : hooks.infrastructureFailure,
    };
    merged.gate = {
      ...gate,
      failClosed:
        rawGate.failClosed === undefined ? true : gate.failClosed,
    };
  }
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
