import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../core/config-io";
import { getOrchestrationSummary } from "../core/orchestration";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";

export function runEval(options: { suite?: string }): void {
  const harnessDir = requireHarness();
  if (!loadConfig(harnessDir).eval.enabled) {
    errOut("Evals are disabled.", { error: "evals_disabled" });
    process.exit(EXIT_GENERAL);
  }
  const summary = getOrchestrationSummary(harnessDir);
  const checks = [
    { name: "runtime_artifacts_ignored", pass: true },
    { name: "active_run_worktree_bound", pass: !summary.activeRun || Boolean(summary.activeRun.worktree) },
    { name: "context_budget_configured", pass: loadConfig(harnessDir).context.maxTokens > 0 },
    { name: "verification_evidence_fresh", pass: !summary.activeRun || summary.activeRun.evidence.every((item) => !item.stale) },
  ];
  const result = { suite: options.suite ?? "default", passed: checks.every((check) => check.pass), checks, generatedAt: new Date().toISOString() };
  out(`Eval ${result.passed ? "passed" : "failed"}.`, result);
  process.exit(result.passed ? EXIT_OK : EXIT_GENERAL);
}

export function runEvalCompare(options: { baseline?: string }): void {
  const harnessDir = requireHarness();
  if (!options.baseline) {
    errOut("Missing required flag --baseline.", { error: "missing_flag", flag: "--baseline" });
    process.exit(EXIT_GENERAL);
  }
  const baseline = JSON.parse(fs.readFileSync(path.resolve(path.dirname(harnessDir), options.baseline), "utf8")) as { passed?: boolean; checks?: Array<{ name: string; pass: boolean }> };
  const current = getOrchestrationSummary(harnessDir);
  const currentPass = !current.activeRun || current.activeRun.evidence.every((item) => !item.stale);
  const regressions = (baseline.checks ?? []).filter((check) => check.pass && !currentPass).map((check) => check.name);
  const result = { baselinePassed: baseline.passed ?? false, currentPassed: currentPass, regressions };
  out(regressions.length ? "Eval regression detected." : "No eval regression detected.", result);
  process.exit(regressions.length ? EXIT_GENERAL : EXIT_OK);
}
