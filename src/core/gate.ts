import * as path from "node:path";
import { defaultGateConfig, type HarnessConfig } from "./config";
import { loadConfig } from "./config-io";
import { listOpenDecisions, readAllDecisions } from "./decisions";
import { warn } from "./io";
import { readActiveLearnings } from "./memory";
import {
  appendOrchestrationEvent,
  getActiveStep,
  getOrchestrationSummary,
} from "./orchestration";
import { getSrsStatus } from "./srs-state";

export interface GateInput {
  file?: string;
  command?: string;
}

export interface GateResult {
  decision: "allow" | "deny";
  reason: string;
}

function normalizeRelativePath(harnessDir: string, file: string): string {
  const projectRoot = path.dirname(harnessDir);
  const normalized = file.replace(/\\/g, "/");
  if (path.isAbsolute(file)) {
    return path.relative(projectRoot, file).replace(/\\/g, "/");
  }
  return normalized;
}

function globToRegExp(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  const p = pattern.replace(/\\/g, "/");
  while (i < p.length) {
    const c = p.charAt(i);
    if (c === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re);
}

/** Match a project-relative file path against glob patterns. */
export function matchesGlob(file: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalized = file.replace(/\\/g, "/");
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function collectSensitivePatterns(harnessDir: string, config: HarnessConfig): string[] {
  const patterns: string[] = [];
  for (const learning of readActiveLearnings(harnessDir)) {
    if (learning.sourceItemId) {
      patterns.push(...learning.scope);
    }
  }
  for (const [, globs] of Object.entries(config.srs.moduleMap)) {
    patterns.push(...globs);
  }
  return [...new Set(patterns)];
}

function hasResolvedDecisionCovering(harnessDir: string, file: string): boolean {
  const resolved = readAllDecisions(harnessDir).filter((d) => d.status === "resolved");
  return resolved.some((d) => matchesGlob(file, d.scopes));
}

function openDecisionDenyReason(
  id: string,
  question: string,
): string {
  return (
    `Open discussion blocks changes (${id}): "${question}". ` +
    `Resolve with: contextpilot decision resolve --id ${id} --resolution "<answer>" --json`
  );
}

function scopeDenyReason(file: string, scopeHint: string): string {
  return (
    `File "${file}" is in a gated scope (${scopeHint}) with no resolved decision covering it. ` +
    `Run: contextpilot decision open --question "<your question>" --scope "${scopeHint}" --json`
  );
}

function srsBootstrapScope(config: HarnessConfig): string[] {
  const paths = new Set([config.srs.bootstrapPath, config.srs.path]);
  return [...paths].map((p) => `${p.replace(/\\/g, "/").replace(/\/+$/, "")}/**`);
}

function srsBootstrapDenyReason(file: string): string {
  return (
    `File "${file}" is in a business scope, but this greenfield project has no SRS bootstrap yet. ` +
    "Run: contextpilot srs bootstrap --json"
  );
}

function orchestrationDeny(
  harnessDir: string,
  runId: string,
  stepId: string | undefined,
  reason: string,
): GateResult {
  appendOrchestrationEvent(harnessDir, {
    runId,
    stepId,
    type: "gate_denied",
    message: reason,
  });
  return { decision: "deny", reason };
}

function evaluateFile(
  harnessDir: string,
  config: HarnessConfig,
  file: string,
): GateResult {
  const relFile = normalizeRelativePath(harnessDir, file);

  if (
    config.srs.requiredForGreenfield &&
    config.srs.bootstrapMode === "strict" &&
    getSrsStatus(harnessDir).status === "missing" &&
    !matchesGlob(relFile, srsBootstrapScope(config)) &&
    matchesGlob(relFile, config.gate.businessScopes)
  ) {
    return {
      decision: "deny",
      reason: srsBootstrapDenyReason(relFile),
    };
  }

  const open = listOpenDecisions(harnessDir);
  if (open.length > 0) {
    const first = open[0];
    if (first) {
      return {
        decision: "deny",
        reason: openDecisionDenyReason(first.id, first.question),
      };
    }
  }

  if (config.gate.mode === "sensitive-only") {
    const patterns = collectSensitivePatterns(harnessDir, config);
    if (matchesGlob(relFile, patterns) && !hasResolvedDecisionCovering(harnessDir, relFile)) {
      const scopeHint = patterns.find((p) => matchesGlob(relFile, [p])) ?? patterns[0] ?? relFile;
      return {
        decision: "deny",
        reason: scopeDenyReason(relFile, scopeHint),
      };
    }
  } else if (config.gate.mode === "strict") {
    const patterns = config.gate.businessScopes;
    if (matchesGlob(relFile, patterns) && !hasResolvedDecisionCovering(harnessDir, relFile)) {
      const scopeHint = patterns.find((p) => matchesGlob(relFile, [p])) ?? patterns[0] ?? relFile;
      return {
        decision: "deny",
        reason: scopeDenyReason(relFile, scopeHint),
      };
    }
  }

  if (config.orchestration.enabled && config.orchestration.stepAwareGate) {
    const summary = getOrchestrationSummary(harnessDir);
    const run = summary.activeRun;
    if (run) {
      const step = getActiveStep(run);
      if (run.status === "blocked" || run.status === "failed") {
        return orchestrationDeny(
          harnessDir,
          run.id,
          step?.id,
          `Orchestration run ${run.id} is ${run.status}; resolve or advance it before editing files.`,
        );
      }
      if (!matchesGlob(relFile, run.scope)) {
        return orchestrationDeny(
          harnessDir,
          run.id,
          step?.id,
          `File "${relFile}" is outside active orchestration scope (${run.scope.join(", ")}).`,
        );
      }
      if (step && !step.allowedActions.includes("edit")) {
        return orchestrationDeny(
          harnessDir,
          run.id,
          step.id,
          `Current orchestration step "${step.id}" (${step.role}) does not allow file edits. Complete or advance the step first.`,
        );
      }
    }
  }

  return { decision: "allow", reason: "" };
}

function evaluateCommand(harnessDir: string): GateResult {
  const open = listOpenDecisions(harnessDir);
  if (open.length > 0) {
    const first = open[0];
    if (first) {
      return {
        decision: "deny",
        reason: openDecisionDenyReason(first.id, first.question),
      };
    }
  }
  return { decision: "allow", reason: "" };
}

/**
 * Gate evaluation per spec section 7.1.
 * File-based scope checks run when `input.file` is set; command-only input blocks on open discussions.
 */
export function evaluate(harnessDir: string, input: GateInput): GateResult {
  let config: HarnessConfig;
  try {
    config = loadConfig(harnessDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (defaultGateConfig().failClosed) {
      return {
        decision: "deny",
        reason: `Gate config read failed (failClosed): ${message}`,
      };
    }
    warn(`Gate config read failed (fail open): ${message}`);
    return { decision: "allow", reason: "" };
  }

  if (!config.gate.enabled) {
    return { decision: "allow", reason: "" };
  }

  try {
    if (input.file) {
      return evaluateFile(harnessDir, config, input.file);
    }
    if (input.command) {
      return evaluateCommand(harnessDir);
    }
    return { decision: "allow", reason: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (config.gate.failClosed) {
      return {
        decision: "deny",
        reason: `Gate evaluation failed (failClosed): ${message}`,
      };
    }
    warn(`Gate evaluation failed (fail open): ${message}`);
    return { decision: "allow", reason: "" };
  }
}
