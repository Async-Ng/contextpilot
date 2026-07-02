import chalk from "chalk";
import { EXIT_OK, out, requireHarness } from "../core/io";
import { computeStatus } from "../core/status-logic";

export function runStatus(): void {
  const harnessDir = requireHarness();
  const report = computeStatus(harnessDir);

  const hasIssues =
    report.drift.length > 0 ||
    report.missing.length > 0 ||
    report.newExternal.length > 0 ||
    report.newSkills.length > 0 ||
    report.pending.length > 0 ||
    report.inDiscussion;

  const lines: string[] = [chalk.bold("ContextPilot status:")];

  if (report.drift.length > 0) {
    lines.push(chalk.yellow(`Drift (${report.drift.length}):`));
    for (const d of report.drift) {
      lines.push(`  ${d.path}`);
    }
  }
  if (report.missing.length > 0) {
    lines.push(chalk.red(`Missing (${report.missing.length}):`));
    for (const m of report.missing) {
      lines.push(`  ${m}`);
    }
  }
  if (report.newExternal.length > 0) {
    lines.push(chalk.cyan(`New external (${report.newExternal.length}):`));
    for (const e of report.newExternal) {
      lines.push(`  [${e.agent}/${e.level}] ${e.path}`);
    }
  }
  if (report.newSkills.length > 0) {
    lines.push(chalk.cyan(`New skills (${report.newSkills.length}):`));
    for (const s of report.newSkills) {
      lines.push(`  ${s.name}: ${s.path}`);
    }
  }
  if (report.pending.length > 0) {
    lines.push(chalk.magenta(`Pending rules (${report.pending.length}):`));
    for (const p of report.pending) {
      lines.push(`  ${p.id}: ${p.title}`);
    }
  }
  if (report.inDiscussion) {
    lines.push(chalk.yellow(`Open discussion (${report.openDecisions.length}):`));
    for (const d of report.openDecisions) {
      lines.push(`  ${d.id}: ${d.question}`);
    }
  }
  if (report.orchestration.activeRun) {
    const run = report.orchestration.activeRun;
    const step = report.orchestration.activeStep;
    lines.push(chalk.cyan(`Active orchestration: ${run.id}`));
    lines.push(`  Goal: ${run.goal}`);
    lines.push(`  Step: ${step ? `${step.id} (${step.role})` : "none"}`);
  }
  if (!hasIssues && !report.orchestration.activeRun) {
    lines.push(chalk.green("All clean."));
  }

  out(lines.join("\n"), report);
  process.exit(hasIssues ? 1 : EXIT_OK);
}
