import { getChangedPaths, getGitDiffDigest } from "../core/git";
import { getRunById, getActiveRun, listEvents } from "../core/orchestration";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";

export function runRunReport(options: { run?: string }): void {
  const harnessDir = requireHarness();
  const run = options.run ? getRunById(harnessDir, options.run) : getActiveRun(harnessDir);
  if (!run) {
    errOut("Run not found.", { error: "run_not_found" });
    process.exit(EXIT_GENERAL);
  }
  const events = listEvents(harnessDir).filter((event) => event.runId === run.id);
  const report = {
    runId: run.id,
    revision: run.revision,
    status: run.status,
    goal: run.goal,
    scope: run.scope,
    worktree: run.worktree,
    contract: run.contract,
    transitions: events.map((event) => ({ type: event.type, stepId: event.stepId, createdAt: event.createdAt, outcome: event.outcome })),
    changedFiles: getChangedPaths(harnessDir),
    currentDiffDigest: getGitDiffDigest(harnessDir),
    verification: run.evidence,
    handoff: run.handoff,
    unresolvedRisk: run.contract.riskLevel === "high" || run.evidence.some((item) => item.exitCode !== 0 || item.stale),
  };
  out(`Run report: ${run.id}`, report);
  process.exit(EXIT_OK);
}
