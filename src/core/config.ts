import { z } from "zod";

const agentSchema = z.enum(["claude", "cursor", "codex", "windsurf", "copilot"]);

const targetConfigSchema = z.object({
  output: z.string(),
});

const scanConfigSchema = z.object({
  include: z.array(z.string()),
  exclude: z.array(z.string()),
  maxDepth: z.number().int().positive(),
});

const discoverConfigSchema = z.object({
  paths: z.record(z.unknown()).default({}),
  dedupeGlobal: z.boolean().default(true),
});

const srsConfigSchema = z.object({
  path: z.string(),
  skillPath: z.string(),
  requiredForGreenfield: z.boolean().default(true),
  bootstrapPath: z.string().default("docs/srs"),
  bootstrapMode: z.enum(["nudge", "strict"]).default("nudge"),
  moduleMap: z.record(z.array(z.string())).default({}),
  autoIngestOnDrift: z.boolean().default(true),
});

export const knowledgeModeSchema = z.enum(["manifest", "inline"]);
export const globalKnowledgePolicySchema = z.enum(["summary", "full", "index-only"]);
export const listKnowledgeInMainFileSchema = z.enum(["compact", "full", "none"]);
export const profileSchema = z.enum(["light", "strict"]);
export const protocolLevelSchema = z.enum(["stub", "standard"]);
export const infrastructureFailureSchema = z.enum(["warn-open", "fail-closed"]);
export const orchestrationAutoStartSchema = z.enum(["never", "non-trivial", "always"]);

export const agentContextConfigSchema = z.object({
  knowledgeMode: knowledgeModeSchema,
  knowledgeIndexFile: z.string(),
  knowledgeExcerptChars: z.number().int().positive(),
  maxMainFileChars: z.number().int().positive(),
  globalKnowledgePolicy: globalKnowledgePolicySchema.default("index-only"),
  globalSummaryMaxChars: z.number().int().positive().default(4000),
  relevantDefaultSections: z.array(z.string()).default(["07", "03"]),
  relevantDefaultLimit: z.number().int().positive().default(2),
  relevantGroupByModule: z.boolean().default(true),
  listKnowledgeInMainFile: listKnowledgeInMainFileSchema.default("compact"),
  protocolLevel: protocolLevelSchema.default("stub"),
});

export const gateModeSchema = z.enum(["sensitive-only", "strict"]);
export const confirmModeSchema = z.enum(["chat", "terminal", "high-severity-terminal"]);

export const gateConfigSchema = z.object({
  enabled: z.boolean(),
  mode: gateModeSchema,
  businessScopes: z.array(z.string()),
  toolsMatcher: z.string(),
  decisionsFile: z.string(),
  confirmMode: confirmModeSchema,
  failClosed: z.boolean(),
});

export const orchestrationModeSchema = z.enum(["prescriptive"]);

export const orchestrationConfigSchema = z.object({
  enabled: z.boolean(),
  mode: orchestrationModeSchema,
  defaultWorkflow: z.enum(["coding"]),
  stepAwareGate: z.boolean(),
  requireReviewBeforeComplete: z.boolean(),
  runsFile: z.string(),
  eventsFile: z.string(),
  autoStart: orchestrationAutoStartSchema.default("non-trivial"),
});

export const hooksConfigSchema = z.object({
  infrastructureFailure: infrastructureFailureSchema.default("warn-open"),
});

export const harnessConfigSchema = z.object({
  profile: profileSchema.default("light"),
  agents: z.array(agentSchema).min(1),
  targets: z.object({
    claude: targetConfigSchema,
    cursor: targetConfigSchema,
    codex: targetConfigSchema,
    windsurf: targetConfigSchema,
    copilot: targetConfigSchema,
  }),
  rulesDir: z.string(),
  contextFile: z.string(),
  memoryFile: z.string(),
  archiveFile: z.string(),
  stateFile: z.string(),
  header: z.string(),
  maxLearningsPerFile: z.number().int().positive(),
  dedupeGlobal: z.boolean(),
  scan: scanConfigSchema,
  discover: discoverConfigSchema,
  srs: srsConfigSchema,
  agentContext: agentContextConfigSchema,
  gate: gateConfigSchema,
  orchestration: orchestrationConfigSchema,
  hooks: hooksConfigSchema.default({ infrastructureFailure: "warn-open" }),
});

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;
export type SrsConfig = z.infer<typeof srsConfigSchema>;
export type AgentName = z.infer<typeof agentSchema>;
export type AgentContextConfig = z.infer<typeof agentContextConfigSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type HooksConfig = z.infer<typeof hooksConfigSchema>;
export type KnowledgeMode = z.infer<typeof knowledgeModeSchema>;
export type GateConfig = z.infer<typeof gateConfigSchema>;
export type GateMode = z.infer<typeof gateModeSchema>;
export type ConfirmMode = z.infer<typeof confirmModeSchema>;
export type OrchestrationConfig = z.infer<typeof orchestrationConfigSchema>;

/** Gate defaults - public contract for v0.2 consumers (S1/S2/S3). */
export function defaultGateConfig(): GateConfig {
  return {
    enabled: true,
    mode: "sensitive-only",
    businessScopes: ["src/**", "lib/**", "app/**", "docs/srs/**"],
    toolsMatcher: "Write|Edit|MultiEdit|NotebookEdit|Bash",
    decisionsFile: ".contextpilot/decisions/decisions.jsonl",
    confirmMode: "chat",
    failClosed: false,
  };
}

export function defaultOrchestrationConfig(): OrchestrationConfig {
  return {
    enabled: true,
    mode: "prescriptive",
    defaultWorkflow: "coding",
    stepAwareGate: true,
    requireReviewBeforeComplete: true,
    runsFile: ".contextpilot/orchestration/runs.jsonl",
    eventsFile: ".contextpilot/orchestration/events.jsonl",
    autoStart: "non-trivial",
  };
}

export function defaultHooksConfig(): HooksConfig {
  return {
    infrastructureFailure: "warn-open",
  };
}

export function defaultAgentContextConfig(): AgentContextConfig {
  return {
    knowledgeMode: "manifest",
    knowledgeIndexFile: ".contextpilot/context/knowledge-index.md",
    knowledgeExcerptChars: 240,
    maxMainFileChars: 120000,
    globalKnowledgePolicy: "index-only",
    globalSummaryMaxChars: 4000,
    relevantDefaultSections: ["07", "03"],
    relevantDefaultLimit: 2,
    relevantGroupByModule: true,
    listKnowledgeInMainFile: "compact",
    protocolLevel: "stub",
  };
}

export function defaultConfig(agents: AgentName[] = ["claude", "cursor", "codex"]): HarnessConfig {
  return {
    profile: "light",
    agents,
    targets: {
      claude: { output: "CLAUDE.md" },
      cursor: { output: ".cursor/rules/" },
      codex: { output: "AGENTS.md" },
      windsurf: { output: ".windsurfrules" },
      copilot: { output: ".github/copilot-instructions.md" },
    },
    rulesDir: ".contextpilot/rules",
    contextFile: ".contextpilot/context/current.md",
    memoryFile: ".contextpilot/memory/learnings.jsonl",
    archiveFile: ".contextpilot/memory/archive.jsonl",
    stateFile: ".contextpilot/state.json",
    header: "<!-- Auto-generated by ContextPilot. Do not edit manually. -->",
    maxLearningsPerFile: 30,
    dedupeGlobal: true,
    scan: {
      include: ["docs/**", ".github/**", "*.md"],
      exclude: ["node_modules", "dist", "README.md", "CHANGELOG.md", "LICENSE.md"],
      maxDepth: 3,
    },
    discover: {
      paths: {},
      dedupeGlobal: true,
    },
    srs: {
      path: "docs/srs",
      skillPath: ".contextpilot/skills/fullstack-to-srs",
      requiredForGreenfield: true,
      bootstrapPath: "docs/srs",
      bootstrapMode: "nudge",
      moduleMap: {},
      autoIngestOnDrift: true,
    },
    agentContext: defaultAgentContextConfig(),
    gate: defaultGateConfig(),
    orchestration: defaultOrchestrationConfig(),
    hooks: defaultHooksConfig(),
  };
}
