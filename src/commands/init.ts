import * as fs from "node:fs";

import * as path from "node:path";

import * as p from "@clack/prompts";

import chalk from "chalk";

import { adoptRuleItem } from "../core/adopt";

import type { AgentName, HarnessConfig } from "../core/config";

import { defaultConfig } from "../core/config";

import { saveConfig } from "../core/config-io";

import { initFocusFile } from "../core/context";

import { detectAgents } from "../core/detect-agents";

import { scanDiscoverItems } from "../core/discover";

import { getGlobalOptions } from "../core/globals";

import {

  runGateInstall,

  type GateInstallResult,

} from "../core/hook-install";

import {

  EXIT_MISSING_FLAG,

  EXIT_OK,

  errOut,

  getHarnessDir,

  isInteractive,

  out,

  sha256,

  withLock,

  writeAtomic,

} from "../core/io";

import { importScanCandidates, scanDocs } from "../core/scan";

import { ingestSrs, type IngestResult } from "../core/srs";
import { setSrsState } from "../core/srs-state";

import {

  emptyState,

  getStateFilePath,

  loadState,

  saveState,

} from "../core/state";

import { runSync } from "../core/sync";

import { runDiscover } from "./discover";



const AGENT_CHOICES: Array<{ value: AgentName; label: string }> = [

  { value: "claude", label: "Claude Code" },

  { value: "cursor", label: "Cursor" },

  { value: "codex", label: "Codex" },

  { value: "windsurf", label: "Windsurf" },

  { value: "copilot", label: "GitHub Copilot" },

];



export const DEFAULT_AGENTS: AgentName[] = ["claude", "cursor", "codex"];



export interface InitOptions {

  yes?: boolean;

}



function exitInitRequiresYes(): never {

  const jsonObj = {

    error: "requires_yes_flag" as const,

    hint: "Use `contextpilot init --yes` for zero-touch setup",

  };

  errOut(

    "Init in headless mode requires --yes. Use `contextpilot init --yes` for zero-touch setup.",

    jsonObj,

  );

  process.exit(EXIT_MISSING_FLAG);

}



export function scaffoldHarness(

  harnessDir: string,

  cwd: string,

  agents: AgentName[],

): HarnessConfig {

  const config = defaultConfig(agents);



  fs.mkdirSync(path.join(harnessDir, "rules"), { recursive: true });

  fs.mkdirSync(path.join(harnessDir, "context"), { recursive: true });

  fs.mkdirSync(path.join(harnessDir, "memory"), { recursive: true });

  fs.mkdirSync(path.join(harnessDir, "decisions"), { recursive: true });

  fs.mkdirSync(path.join(harnessDir, "orchestration"), { recursive: true });



  saveConfig(harnessDir, config);

  saveState(harnessDir, emptyState());

  initFocusFile(harnessDir);



  const memoryPath = path.join(cwd, config.memoryFile);

  const archivePath = path.join(cwd, config.archiveFile);

  const decisionsPath = path.join(cwd, config.gate.decisionsFile);

  const runsPath = path.join(cwd, config.orchestration.runsFile);

  const eventsPath = path.join(cwd, config.orchestration.eventsFile);

  writeAtomic(memoryPath, "");

  writeAtomic(archivePath, "");

  writeAtomic(decisionsPath, "");

  writeAtomic(runsPath, "");

  writeAtomic(eventsPath, "");



  return config;

}



export async function autoAdoptDiscoverItems(

  harnessDir: string,

): Promise<{ adoptedCount: number; skillsSeen: number }> {

  const items = scanDiscoverItems(harnessDir);

  if (items.length === 0) {

    return { adoptedCount: 0, skillsSeen: 0 };

  }



  const statePath = getStateFilePath(harnessDir);

  return withLock(statePath, () => {

    const state = loadState(harnessDir);

    const projectRoot = path.dirname(harnessDir);

    const adopted: string[] = [];

    const skillsSeen: string[] = [];



    for (const item of items) {

      if (item.kind === "skill") {

        const skillMd = path.join(item.path, "SKILL.md");

        const hash = sha256(fs.readFileSync(skillMd, "utf8"));

        state.skills[item.name] = { level: item.level, hash };

        skillsSeen.push(item.name);

        continue;

      }



      const ruleId = adoptRuleItem(harnessDir, item, {

        type: "knowledge",

        priority: "low",

      });

      const relPath = path.relative(projectRoot, item.path);

      state.adopted[item.path] = ruleId;

      state.adopted[relPath] = ruleId;

      adopted.push(ruleId);

    }



    saveState(harnessDir, state);

    return { adoptedCount: adopted.length, skillsSeen: skillsSeen.length };

  });

}



async function runInitYes(): Promise<void> {

  const cwd = getGlobalOptions().cwd;

  const harnessDir = getHarnessDir(cwd);

  const detected = detectAgents(cwd);

  const agents =
    detected.filter((a) => a !== "codex").length > 0 ? detected : DEFAULT_AGENTS;



  const config = scaffoldHarness(harnessDir, cwd, agents);



  const gateResult: GateInstallResult = runGateInstall(harnessDir, {

    agent: agents,

  });



  let srsResult: IngestResult | null = null;

  const srsDir = path.join(cwd, config.srs.path);

  if (fs.existsSync(srsDir)) {

    srsResult = await ingestSrs(harnessDir);

  } else if (config.srs.requiredForGreenfield) {

    await setSrsState(harnessDir, "missing", config.srs.bootstrapPath);

  }



  const discoverResult = await autoAdoptDiscoverItems(harnessDir);

  await runSync(harnessDir);



  const summary = {

    status: "initialized",

    mode: "zero-touch",

    harnessDir,

    agents,

    detectedAgents: detected,

    gate: gateResult,

    srs: srsResult,

    discover: discoverResult,

    importedRules: discoverResult.adoptedCount,

    paths: {

      config: path.join(harnessDir, "harness.config.json"),

      rules: path.join(cwd, config.rulesDir),

      context: path.join(cwd, config.contextFile),

      memory: path.join(cwd, config.memoryFile),

      decisions: path.join(cwd, config.gate.decisionsFile),

      orchestrationRuns: path.join(cwd, config.orchestration.runsFile),

      orchestrationEvents: path.join(cwd, config.orchestration.eventsFile),

    },

  };



  const humanParts = [

    `Zero-touch init complete. Agents: ${agents.join(", ")}`,

    `Adopted ${discoverResult.adoptedCount} rule(s), inventoried ${discoverResult.skillsSeen} skill(s).`,

  ];

  if (srsResult) {

    humanParts.push(

      `SRS: ${srsResult.knowledgeUpserted} knowledge rule(s), ${srsResult.learningsSeeded} learning(s) seeded.`,

    );

  }

  if (gateResult.gitHook) {

    humanParts.push("Git pre-commit backstop installed.");

  }



  out(humanParts.join("\n"), summary);

}



export async function runInit(options: InitOptions = {}): Promise<void> {

  if (options.yes) {

    await runInitYes();

    return;

  }



  if (!isInteractive()) {

    exitInitRequiresYes();

  }



  const cwd = getGlobalOptions().cwd;

  const harnessDir = getHarnessDir(cwd);



  if (fs.existsSync(harnessDir)) {

    const overwrite = await p.confirm({

      message: ".contextpilot/ already exists. Re-initialize?",

      initialValue: false,

    });

    if (p.isCancel(overwrite) || !overwrite) {

      p.cancel("Init cancelled.");

      process.exit(EXIT_OK);

    }

  }



  p.intro(chalk.bold("contextpilot init"));



  const selected = await p.multiselect({

    message: "Which agents do you use?",

    options: AGENT_CHOICES,

    required: true,

    initialValues: ["claude", "cursor", "codex"],

  });

  if (p.isCancel(selected)) {

    p.cancel("Init cancelled.");

    process.exit(EXIT_OK);

  }



  const agents = selected as AgentName[];

  const config = scaffoldHarness(harnessDir, cwd, agents);



  let importedRules = 0;



  const scanDocsConfirm = await p.confirm({

    message: "Scan docs for likely rules?",

    initialValue: true,

  });

  if (!p.isCancel(scanDocsConfirm) && scanDocsConfirm) {

    const candidates = scanDocs(harnessDir);

    if (candidates.length > 0) {

      const toImport = await p.multiselect({

        message: "Select docs to import",

        options: candidates.map((c) => ({

          value: c.path,

          label: `${c.relativePath} (${c.classification})`,

          hint: c.classification,

        })),

        initialValues: candidates.filter((c) => c.preSelected).map((c) => c.path),

      });

      if (!p.isCancel(toImport) && Array.isArray(toImport)) {

        const selectedCandidates = candidates.filter((c) =>

          (toImport as string[]).includes(c.path),

        );

        const ids = importScanCandidates(harnessDir, selectedCandidates);

        importedRules += ids.length;

      }

    } else {

      p.log.info("No doc candidates found.");

    }

  }



  const discoverConfirm = await p.confirm({

    message: "Discover existing agent rules/skills?",

    initialValue: true,

  });

  if (!p.isCancel(discoverConfirm) && discoverConfirm) {

    const items = scanDiscoverItems(harnessDir);

    if (items.length > 0) {

      const result = await runDiscover({ dryRun: false, internal: true });

      importedRules += result?.adoptedCount ?? 0;

    }

  }



  const syncConfirm = await p.confirm({

    message: "Sync agent targets now?",

    initialValue: true,

  });

  if (!p.isCancel(syncConfirm) && syncConfirm) {

    await runSync(harnessDir);

  }



  const summary = {

    status: "initialized",

    harnessDir,

    agents,

    importedRules,

    paths: {

      config: path.join(harnessDir, "harness.config.json"),

      rules: path.join(cwd, config.rulesDir),

      context: path.join(cwd, config.contextFile),

      memory: path.join(cwd, config.memoryFile),

      orchestrationRuns: path.join(cwd, config.orchestration.runsFile),

      orchestrationEvents: path.join(cwd, config.orchestration.eventsFile),

    },

  };



  out(

    `Initialized .contextpilot/ with agents: ${agents.join(", ")}\nImported ${importedRules} rule(s).`,

    summary,

  );



  p.outro(chalk.green("Done!"));

}


