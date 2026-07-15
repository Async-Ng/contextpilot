import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { resolveContextPilotCommand, resolvedCommandWithSubcommand } from "../core/command-resolution";
import { loadConfig } from "../core/config-io";
import { EXIT_OK, getHarnessDir, out } from "../core/io";
import {
  computeStatus,
  getStatusActionHint,
  getStatusConfidenceSummary,
  hasStatusIssues,
} from "../core/status-logic";

export function runStart(): void {
  const cwd = process.cwd();
  const harnessDir = getHarnessDir(cwd);
  const configPath = path.join(harnessDir, "harness.config.json");
  const resolved = resolveContextPilotCommand(cwd);
  const initialized = fs.existsSync(configPath);

  if (!initialized) {
    const suggestedCommand = resolvedCommandWithSubcommand(cwd, "setup").invocation;
    const human = [
      chalk.bold("ContextPilot start:"),
      `CLI resolution: ${resolved.command} (${resolved.source})`,
      "Project is not initialized.",
      `Next: ${suggestedCommand}`,
    ].join("\n");

    out(human, {
      status: "action_needed",
      initialized: false,
      cliResolution: resolved,
      harnessDir,
      suggestedCommand,
      confidenceSummary: "CLI usable, project not initialized",
    });
    process.exit(EXIT_OK);
  }

  const config = loadConfig(harnessDir);
  const report = computeStatus(harnessDir, { fast: true });
  const projectRoot = path.dirname(harnessDir);
  const suggestedCommand = getStatusActionHint(report, projectRoot);
  const ready = !hasStatusIssues(report) &&
    report.srs?.status !== "missing" &&
    report.srs?.status !== "bootstrapped";

  const lines = [
    chalk.bold("ContextPilot start:"),
    `CLI resolution: ${resolved.command} (${resolved.source})`,
    `State: ${ready ? "ready" : "action needed"}`,
    `Profile: ${config.profile}`,
    `Hook infrastructure failures: ${config.hooks.infrastructureFailure}`,
    `Confidence: ${getStatusConfidenceSummary(report)}`,
  ];
  if (report.srs) {
    lines.push(`SRS: ${report.srs.status} (${report.srs.path})`);
  }
  if (report.orchestration.activeRun) {
    lines.push(`Active run: ${report.orchestration.activeRun.id} (${report.orchestration.activeStep?.id ?? "none"})`);
  } else {
    lines.push("Active run: none");
  }
  lines.push(`Next: ${suggestedCommand}`);

  out(lines.join("\n"), {
    status: ready ? "ready" : "action_needed",
    initialized: true,
    cliResolution: resolved,
    harnessDir,
    confidenceSummary: getStatusConfidenceSummary(report),
    profile: config.profile,
    hooks: config.hooks,
    suggestedCommand,
    readiness: {
      generated: report.generated,
      inDiscussion: report.inDiscussion,
      openDecisionCount: report.openDecisions.length,
      partial: report.diagnostics.partial,
    },
    orchestration: report.orchestration,
    srs: report.srs,
    diagnostics: report.diagnostics,
  });
  process.exit(EXIT_OK);
}
