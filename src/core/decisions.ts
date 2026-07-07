import * as fs from "node:fs";
import * as path from "node:path";
import { nanoid } from "nanoid";
import { loadConfig, resolveProjectPath } from "./config-io";
import { decisionSchema, type Decision } from "./decision-schema";
import { appendLine, warn, withLock, writeAtomic } from "./io";
import { globHasMatches, type StaleScope } from "./scope-match";
import { getStateFilePath } from "./state";

export interface OpenDecisionInput {
  question: string;
  detail?: string;
  scopes?: string[];
  sourceItemId?: string;
}

function getDecisionsFilePath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  return resolveProjectPath(harnessDir, config.gate.decisionsFile);
}

function parseJsonlLines(filePath: string): Decision[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim());
  const decisions: Decision[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const raw: unknown = JSON.parse(line);
      decisions.push(decisionSchema.parse(raw));
    } catch {
      warn(`Skipping corrupt line ${i + 1} in ${filePath}`);
    }
  }
  return decisions;
}

function rewriteJsonl(filePath: string, decisions: Decision[]): void {
  const content = decisions.map((d) => JSON.stringify(d)).join("\n");
  writeAtomic(filePath, content ? `${content}\n` : "");
}

export function readAllDecisions(harnessDir: string): Decision[] {
  const decisionsPath = getDecisionsFilePath(harnessDir);
  return parseJsonlLines(decisionsPath);
}

export function listOpenDecisions(harnessDir: string): Decision[] {
  return readAllDecisions(harnessDir).filter((d) => d.status === "open");
}

export function hasOpenDiscussion(harnessDir: string): boolean {
  return listOpenDecisions(harnessDir).length > 0;
}

function appendDecisionUnlocked(
  harnessDir: string,
  input: OpenDecisionInput,
): Decision {
  const decisionsPath = getDecisionsFilePath(harnessDir);
  const decision: Decision = {
    id: `dec_${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    status: "open",
    question: input.question,
    detail: input.detail ?? "",
    scopes: input.scopes ?? ["**/*"],
    sourceItemId: input.sourceItemId,
  };
  appendLine(decisionsPath, JSON.stringify(decision));
  return decision;
}

export async function appendDecision(
  harnessDir: string,
  input: OpenDecisionInput,
): Promise<Decision> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => appendDecisionUnlocked(harnessDir, input));
}

function updateDecisionUnlocked(
  harnessDir: string,
  id: string,
  update: (decision: Decision) => Decision | null,
): Decision | null {
  const decisionsPath = getDecisionsFilePath(harnessDir);
  const decisions = readAllDecisions(harnessDir);
  const idx = decisions.findIndex((d) => d.id === id && d.status === "open");
  if (idx === -1) {
    return null;
  }
  const current = decisions[idx];
  if (!current) {
    return null;
  }
  const updated = update(current);
  if (!updated) {
    return null;
  }
  decisions[idx] = updated;
  rewriteJsonl(decisionsPath, decisions);
  return updated;
}

export async function resolveDecision(
  harnessDir: string,
  id: string,
  resolution: string,
): Promise<Decision | null> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () =>
    updateDecisionUnlocked(harnessDir, id, (decision) => ({
      ...decision,
      status: "resolved",
      resolution,
      resolvedAt: new Date().toISOString(),
    })),
  );
}

export async function rejectDecision(
  harnessDir: string,
  id: string,
): Promise<Decision | null> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () =>
    updateDecisionUnlocked(harnessDir, id, (decision) => ({
      ...decision,
      status: "rejected",
      rejectedAt: new Date().toISOString(),
    })),
  );
}

export type StaleDecisionScope = StaleScope;

/**
 * Flags decision scope globs that match zero files on disk - a typo'd glob,
 * or a scope that was valid when the decision was opened/resolved but whose
 * referenced code has since been deleted or renamed. Nothing else in the
 * tool ever re-validates a decision's scope once it's written.
 */
export function getStaleDecisionScopes(harnessDir: string): StaleDecisionScope[] {
  const projectRoot = path.dirname(harnessDir);
  const stale: StaleDecisionScope[] = [];
  for (const decision of readAllDecisions(harnessDir)) {
    if (decision.status === "rejected") continue;
    for (const scope of decision.scopes) {
      if (!globHasMatches(projectRoot, scope)) {
        stale.push({ id: decision.id, scope });
      }
    }
  }
  return stale;
}

export { type Decision };
