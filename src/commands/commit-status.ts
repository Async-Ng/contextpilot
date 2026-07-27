import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { loadConfig } from "../core/config-io";
import { getOrchestrationSummary } from "../core/orchestration";
import { getRuntimeDir, isRuntimeExternalized } from "../core/runtime";
import { loadState, toStatePathKey } from "../core/state";
import { EXIT_OK, out, requireHarness } from "../core/io";

export interface CommitStatusReport {
  status: "commit_status";
  runId?: string;
  productChanges: string[];
  durableContext: string[];
  generatedContext: string[];
  runtimeOnly: string[];
  unknownContext: string[];
  recommendedCommitPaths: string[];
  safeToCommitRecommended: boolean;
}

function parsePorcelain(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const pathPart = line.slice(3);
      const renamed = pathPart.split(" -> ");
      return (renamed.at(-1) ?? pathPart).replace(/\\/g, "/");
    });
}

function gitChangedFiles(projectRoot: string): string[] {
  try {
    return parsePorcelain(
      execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch {
    return [];
  }
}

function isDurableContextPath(config: ReturnType<typeof loadConfig>, relPath: string): boolean {
  const durable = [
    ".contextpilot/harness.config.json",
    config.rulesDir,
    config.contextFile,
    config.memoryFile,
    config.archiveFile,
    config.gate.decisionsFile,
  ].map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""));
  return durable.some((p) => relPath === p || relPath.startsWith(`${p}/`));
}

export function buildCommitStatus(harnessDir: string): CommitStatusReport {
  const projectRoot = path.dirname(harnessDir);
  const config = loadConfig(harnessDir);
  const state = loadState(harnessDir);
  const orchestration = getOrchestrationSummary(harnessDir);
  const generated = new Set(Object.keys(state.generated));
  const runtimeRel = toStatePathKey(harnessDir, getRuntimeDir(harnessDir));
  const files = gitChangedFiles(projectRoot);
  const report: CommitStatusReport = {
    status: "commit_status",
    runId: orchestration.activeRun?.id,
    productChanges: [],
    durableContext: [],
    generatedContext: [],
    runtimeOnly: [],
    unknownContext: [],
    recommendedCommitPaths: [],
    safeToCommitRecommended: true,
  };

  for (const relPath of files) {
    const normalized = relPath.replace(/\\/g, "/");
    if (generated.has(normalized)) {
      report.generatedContext.push(normalized);
    } else if (
      normalized.startsWith(".contextpilot/runtime/") ||
      (isRuntimeExternalized(harnessDir) && (normalized === runtimeRel || normalized.startsWith(`${runtimeRel}/`)))
    ) {
      report.runtimeOnly.push(normalized);
    } else if (normalized.startsWith(".contextpilot/")) {
      if (isDurableContextPath(config, normalized)) {
        report.durableContext.push(normalized);
      } else {
        report.unknownContext.push(normalized);
      }
    } else {
      report.productChanges.push(normalized);
    }
  }

  report.recommendedCommitPaths = [
    ...report.productChanges,
    ...report.durableContext,
    ...report.generatedContext,
  ];
  report.safeToCommitRecommended = report.unknownContext.length === 0;
  return report;
}

export function runCommitStatus(): void {
  const harnessDir = requireHarness();
  const report = buildCommitStatus(harnessDir);
  const lines = [
    "ContextPilot commit status:",
    `Product changes: ${report.productChanges.length}`,
    `Durable context: ${report.durableContext.length}`,
    `Generated context: ${report.generatedContext.length}`,
    `Runtime-only: ${report.runtimeOnly.length}`,
    `Unknown context: ${report.unknownContext.length}`,
  ];
  if (report.runId) {
    lines.push(`Run: ${report.runId}`);
  }
  out(lines.join("\n"), report);
  process.exit(EXIT_OK);
}
