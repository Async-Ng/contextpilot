#!/usr/bin/env node
import { Command } from "commander";
import { runAdd } from "./commands/add";
import { runCheckpoint } from "./commands/checkpoint";
import { runContextInject } from "./commands/context";
import {
  runDecisionList,
  runDecisionOpen,
  runDecisionReject,
  runDecisionResolve,
} from "./commands/decision";
import { runDiscover } from "./commands/discover";
import { runDoctor } from "./commands/doctor";
import { runFocus } from "./commands/focus";
import { runForget } from "./commands/forget";
import {
  runGateCheck,
  runGateInstallCommand,
  runGatePrecommit,
} from "./commands/gate";
import { runInit } from "./commands/init";
import {
  runKnowledgeQuery,
  runKnowledgeRelevant,
  runKnowledgeShow,
} from "./commands/knowledge";
import { runLearn } from "./commands/learn";
import { runList } from "./commands/list";
import {
  runOrchestrateAdvance,
  runOrchestrateCancel,
  runOrchestrateEvent,
  runOrchestrateStart,
  runOrchestrateStatus,
} from "./commands/orchestrate";
import { refreshHarness } from "./commands/refresh";
import { runResolve } from "./commands/resolve";
import { runSetup } from "./commands/setup";
import { runStart } from "./commands/start";
import {
  runSrsBootstrap,
  runSrsIngest,
  runSrsInstall,
  runSrsStatus,
} from "./commands/srs";
import { runStatus } from "./commands/status";
import { runSyncCommand } from "./commands/sync";
import { runWatch } from "./commands/watch";
import { setGlobalOptions } from "./core/globals";
import { exitMissingFlag } from "./core/io";

const program = new Command();

program
  .name("contextpilot")
  .description("Pilot AI coding agents with project context, memory, orchestration, and gates")
  .option("--json", "Output machine-readable JSON", false)
  .option("--no-input", "Disable interactive prompts (headless mode)", false)
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts<{ json?: boolean; input?: boolean }>();
    setGlobalOptions({
      json: opts.json ?? false,
      noInput: opts.input === false,
      cwd: process.cwd(),
    });
  });

program
  .command("init")
  .description("Initialize .contextpilot/ (interactive or zero-touch with --yes)")
  .option("--yes", "Zero-touch headless setup: detect agents, install hooks, discover, sync")
  .action(async (opts: { yes?: boolean }) => {
    await runInit({ yes: opts.yes });
  });

program
  .command("setup")
  .description("One-time project setup so humans can chat normally and agents run ContextPilot commands")
  .option("--agent <name>", "Set up one agent: claude, cursor, codex, windsurf, or copilot")
  .option("--no-git", "Skip git pre-commit hook")
  .action(async (opts: { agent?: string; noGit?: boolean }) => {
    await runSetup(opts);
  });

program
  .command("start")
  .description("Safe-start readiness summary with the next recommended command")
  .action(() => {
    runStart();
  });

program
  .command("doctor")
  .description("Check local ContextPilot installation and project setup")
  .action(() => {
    runDoctor();
  });

program
  .command("sync")
  .description("Regenerate agent target files from .contextpilot/")
  .option("--target <agent>", "Sync only one agent target")
  .option("--dry-run", "Preview without writing", false)
  .option("--preview", "Alias for --dry-run with preview-focused output", false)
  .action(async (opts: { target?: string; dryRun?: boolean; preview?: boolean }) => {
    await runSyncCommand(opts);
  });

program
  .command("learn")
  .description("Append a learning to memory (no sync)")
  .requiredOption("--category <category>", "mistake|constraint|gotcha|decision")
  .requiredOption("--severity <severity>", "low|med|high")
  .requiredOption("--title <title>", "Short title")
  .requiredOption("--detail <detail>", "What and why")
  .option("--scope <glob>", "Scope glob(s), comma-separated", "**/*")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--pin", "Pin this learning", false)
  .action((opts) => {
    runLearn(opts);
  });

program
  .command("focus")
  .description("Set current task focus (no sync)")
  .argument("[text]", "Focus text")
  .option("--text <text>", "Focus text")
  .action((text: string | undefined, opts: { text?: string }) => {
    runFocus(text, opts);
  });

program
  .command("status")
  .description("Report drift, missing, external, pending, and open discussions")
  .option("--fast", "Return a lightweight, reliable status summary", false)
  .action((opts: { fast?: boolean }) => {
    runStatus(opts);
  });

program
  .command("list")
  .description("List rules and/or learnings")
  .option("--rules", "List rules only")
  .option("--learnings", "List learnings only")
  .action((opts: { rules?: boolean; learnings?: boolean }) => {
    runList(opts);
  });

const knowledge = program
  .command("knowledge")
  .description("Find and show project knowledge");

knowledge
  .command("query")
  .description("Find knowledge by query text, file, or scope")
  .requiredOption("--query <text>", "Text to match against knowledge title, id, tags, and body")
  .option("--file <path...>", "Relevant file path(s)")
  .option("--scope <glob>", "Relevant scope glob(s), comma-separated")
  .option("--sections <nums>", "Filter by SRS section numbers, comma-separated (e.g. 07,03)")
  .option("--module <slug>", "Filter by module slug(s), comma-separated")
  .option("--task <task>", "Task-aware section ranking: code|data|test|explore")
  .option("--target <agent>", "Filter by agent target")
  .option("--limit <n>", "Maximum results", "10")
  .option("--include-body", "Include full body in JSON output", false)
  .action((opts) => {
    runKnowledgeQuery(opts);
  });

knowledge
  .command("relevant")
  .description("Find knowledge relevant to file path(s)")
  .requiredOption("--file <path...>", "Relevant file path(s)")
  .option("--sections <nums>", "Filter by SRS section numbers, comma-separated (e.g. 07,03)")
  .option("--module <slug>", "Filter by module slug(s), comma-separated")
  .option("--task <task>", "Task-aware section ranking: code|data|test|explore", "code")
  .option("--target <agent>", "Filter by agent target")
  .option("--limit <n>", "Maximum results", "2")
  .action((opts) => {
    runKnowledgeRelevant(opts);
  });

knowledge
  .command("show")
  .description("Show one knowledge item by id")
  .argument("<id>", "Knowledge item id")
  .action((id: string) => {
    runKnowledgeShow(id);
  });

program
  .command("discover")
  .description("Discover and adopt external rules/skills (human-gated)")
  .option("--project-only", "Scan project paths only")
  .option("--global-only", "Scan global paths only")
  .option("--dry-run", "Preview without adopting", false)
  .action(async (opts) => {
    await runDiscover(opts);
  });

program
  .command("refresh")
  .description("Adopt new external items and handle drift")
  .option("--auto", "Auto-adopt without prompts")
  .option("--dry-run", "Preview only", false)
  .action(async (opts) => {
    const result = await refreshHarness(opts);
    const { out, EXIT_OK } = await import("./core/io");
    out(
      `Refresh complete. Adopted ${result.adopted.length}, skills ${result.skillsSeen.length}, drift kept ${result.driftKept.length}.`,
      result,
    );
    process.exit(EXIT_OK);
  });

program
  .command("add")
  .description("Import a .md file or directory as rules (human-gated)")
  .argument("<path>", "File or directory path")
  .action(async (targetPath: string) => {
    await runAdd(targetPath);
  });

program
  .command("resolve")
  .description("Archive an active learning")
  .argument("<id>", "Learning id")
  .action(async (id: string) => {
    await runResolve(id);
  });

program
  .command("forget")
  .description("Permanently delete a learning (human-gated)")
  .argument("<id>", "Learning id")
  .action(async (id: string) => {
    await runForget(id);
  });

const decision = program
  .command("decision")
  .description("Business-logic discussion gate");

decision
  .command("open")
  .description("Open a discussion - blocks gated scopes until resolved")
  .option("--question <text>", "Business question to discuss with the user")
  .option("--detail <text>", "Additional context")
  .option("--scope <glob>", "Affected file glob(s), comma-separated")
  .option("--area <glob>", "Alias for a single scope glob")
  .option("--srs-ref <id>", "Linked SRS item id")
  .option("--proposal <text>", "Proposed approach")
  .option("--options <list>", "Comma-separated options to present")
  .action(async (opts) => {
    await runDecisionOpen(opts);
  });

decision
  .command("list")
  .description("List decisions")
  .option("--open", "Show only open decisions")
  .action((opts: { open?: boolean }) => {
    runDecisionList(opts);
  });

decision
  .command("resolve")
  .description("Resolve an open decision and sync a rule")
  .argument("<id>", "Decision id")
  .option("--resolution <text>", "User's decision / answer")
  .action(async (id: string, opts: { resolution?: string }) => {
    await runDecisionResolve(id, opts);
  });

decision
  .command("reject")
  .description("Reject an open discussion")
  .argument("<id>", "Decision id")
  .option("--reason <text>", "Why the discussion was rejected")
  .action(async (id: string, opts: { reason?: string }) => {
    await runDecisionReject(id, opts);
  });

const gate = program.command("gate").description("Enforcement hooks and pre-commit backstop");

gate
  .command("check")
  .description("Evaluate stdin hook payload for an agent adapter")
  .option("--agent <name>", "Agent adapter: claude, cursor, codex, or copilot")
  .action((opts: { agent?: string }) => {
    runGateCheck(opts);
  });

gate
  .command("precommit")
  .description("Git pre-commit backstop - deny staged files in gated scopes")
  .action(() => {
    runGatePrecommit();
  });

gate
  .command("install")
  .description("Install agent hooks and git pre-commit backstop")
  .option("--agent <name>", "Install for one agent only")
  .option("--no-git", "Skip git pre-commit hook")
  .action((opts: { agent?: string; noGit?: boolean }) => {
    runGateInstallCommand(opts);
  });

const orchestrate = program
  .command("orchestrate")
  .description("Prescriptive orchestration control plane");

orchestrate
  .command("start")
  .description("Start an orchestration run")
  .option("--goal <text>", "Goal for this run")
  .option("--scope <glob>", "Affected file glob(s), comma-separated")
  .option("--workflow <name>", "Workflow name", "coding")
  .action(async (opts: { goal?: string; scope?: string; workflow?: string }) => {
    await runOrchestrateStart(opts);
  });

orchestrate
  .command("status")
  .description("Show active orchestration run")
  .action(() => {
    runOrchestrateStatus();
  });

orchestrate
  .command("advance")
  .description("Advance, block, or fail the active orchestration step")
  .option("--status <status>", "complete|blocked|failed")
  .option("--note <text>", "Evidence or note for this transition")
  .action(async (opts: { status?: "complete" | "blocked" | "failed"; note?: string }) => {
    await runOrchestrateAdvance(opts);
  });

orchestrate
  .command("cancel")
  .description("Cancel the active orchestration run")
  .option("--reason <text>", "Reason for cancellation")
  .action(async (opts: { reason?: string }) => {
    await runOrchestrateCancel(opts);
  });

orchestrate
  .command("event")
  .description("Append an orchestration trace event")
  .option("--type <type>", "Event type")
  .option("--message <text>", "Event message")
  .action((opts: { type?: string; message?: string }) => {
    runOrchestrateEvent(opts);
  });

program
  .command("context")
  .description("Session context for agent hooks")
  .option("--inject", "Output focus, learnings, and open decisions for session start")
  .action((opts: { inject?: boolean }) => {
    if (opts.inject) {
      runContextInject();
      return;
    }
    exitMissingFlag("--inject", "Use `context --inject` for session hook output");
  });

program
  .command("checkpoint")
  .description("Session stop hook: sync agent targets and nudge learn")
  .action(async () => {
    await runCheckpoint();
  });

const srs = program.command("srs").description("SRS integration");

srs
  .command("status")
  .description("Show SRS bootstrap/ingest status")
  .action(async () => {
    await runSrsStatus();
  });

srs
  .command("bootstrap")
  .description("Bootstrap a greenfield SRS-first workflow")
  .action(async () => {
    await runSrsBootstrap();
  });

srs
  .command("install")
  .description("Install bundled fullstack-to-srs skill for all configured agents")
  .action(async () => {
    await runSrsInstall();
  });

srs
  .command("ingest")
  .description("Ingest docs/srs into knowledge rules and seed learnings")
  .option("--path <dir>", "SRS directory override")
  .option("--reingest", "Auto-resolve learnings absent from new SRS", false)
  .action(async (opts: { path?: string; reingest?: boolean }) => {
    await runSrsIngest(opts);
  });

program
  .command("watch")
  .description("Watch .contextpilot/ and auto-sync / refresh")
  .action(async () => {
    await runWatch();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
