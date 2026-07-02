import * as fs from "node:fs";
import { nanoid } from "nanoid";
import { loadConfig, resolveProjectPath } from "./config-io";
import { appendLine, warn, withLock, writeAtomic } from "./io";
import {
  learningSchema,
  SEVERITY_ORDER,
  type Learning,
  type LearningCategory,
  type LearningSeverity,
} from "./learning-schema";
import { getStateFilePath } from "./state";

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function parseJsonlLines(filePath: string): Learning[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim());
  const learnings: Learning[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const raw: unknown = JSON.parse(line);
      learnings.push(learningSchema.parse(raw));
    } catch {
      warn(`Skipping corrupt line ${i + 1} in ${filePath}`);
    }
  }
  return learnings;
}

export function readActiveLearnings(harnessDir: string): Learning[] {
  const config = loadConfig(harnessDir);
  const memoryPath = resolveProjectPath(harnessDir, config.memoryFile);
  return parseJsonlLines(memoryPath).filter((l) => l.status === "active");
}

export function readAllLearnings(harnessDir: string): Learning[] {
  const config = loadConfig(harnessDir);
  const memoryPath = resolveProjectPath(harnessDir, config.memoryFile);
  return parseJsonlLines(memoryPath);
}

export function sortLearnings(learnings: Learning[]): Learning[] {
  return [...learnings].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const sd = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sd !== 0) return sd;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function formatLearningsSection(learnings: Learning[], maxCount: number): string {
  const sorted = sortLearnings(learnings).slice(0, maxCount);
  if (sorted.length === 0) {
    return "";
  }
  const lines = sorted.map(
    (l) => `- [${l.severity.toUpperCase()}] ${l.title}: ${l.detail}`,
  );
  return lines.join("\n");
}

export interface LearnInput {
  category: LearningCategory;
  severity: LearningSeverity;
  title: string;
  detail: string;
  scope?: string[];
  tags?: string[];
  pinned?: boolean;
  sourceItemId?: string;
}

export function findDuplicate(
  learnings: Learning[],
  input: LearnInput,
): Learning | undefined {
  return learnings.find((l) => {
    if (l.status !== "active") return false;
    if (input.sourceItemId && l.sourceItemId === input.sourceItemId) return true;
    return normalizeTitle(l.title) === normalizeTitle(input.title);
  });
}

export function appendLearning(harnessDir: string, input: LearnInput): {
  status: "learned" | "duplicate";
  id: string;
} {
  const config = loadConfig(harnessDir);
  const memoryPath = resolveProjectPath(harnessDir, config.memoryFile);
  const active = readActiveLearnings(harnessDir);
  const dup = findDuplicate(active, input);
  if (dup) {
    return { status: "duplicate", id: dup.id };
  }
  const learning: Learning = {
    id: `lrn_${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    category: input.category,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    scope: input.scope ?? ["**/*"],
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    status: "active",
    sourceItemId: input.sourceItemId,
  };
  appendLine(memoryPath, JSON.stringify(learning));
  return { status: "learned", id: learning.id };
}

function resolveLearningUnlocked(harnessDir: string, id: string): boolean {
  const config = loadConfig(harnessDir);
  const memoryPath = resolveProjectPath(harnessDir, config.memoryFile);
  const archivePath = resolveProjectPath(harnessDir, config.archiveFile);
  const learnings = readAllLearnings(harnessDir);
  const idx = learnings.findIndex((l) => l.id === id && l.status === "active");
  if (idx === -1) return false;
  const learning = learnings[idx];
  if (!learning) return false;
  const archived: Learning = { ...learning, status: "archived" };
  appendLine(archivePath, JSON.stringify(archived));
  const remaining = learnings.filter((_, i) => i !== idx);
  rewriteJsonl(memoryPath, remaining);
  return true;
}

export async function resolveLearning(
  harnessDir: string,
  id: string,
): Promise<boolean> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => resolveLearningUnlocked(harnessDir, id));
}

export async function forgetLearning(harnessDir: string, id: string): Promise<boolean> {
  const statePath = getStateFilePath(harnessDir);
  return withLock(statePath, () => {
    const config = loadConfig(harnessDir);
    const memoryPath = resolveProjectPath(harnessDir, config.memoryFile);
    const learnings = readAllLearnings(harnessDir);
    const filtered = learnings.filter((l) => l.id !== id);
    if (filtered.length === learnings.length) return false;
    rewriteJsonl(memoryPath, filtered);
    return true;
  });
}

export function autoResolveBySourceIds(
  harnessDir: string,
  presentIds: Set<string>,
): number {
  const learnings = readAllLearnings(harnessDir);
  let count = 0;
  for (const l of learnings) {
    if (
      l.status === "active" &&
      l.sourceItemId &&
      !presentIds.has(l.sourceItemId)
    ) {
      if (resolveLearningUnlocked(harnessDir, l.id)) count++;
    }
  }
  return count;
}

function rewriteJsonl(filePath: string, learnings: Learning[]): void {
  const content = learnings.map((l) => JSON.stringify(l)).join("\n");
  writeAtomic(filePath, content ? `${content}\n` : "");
}

export { type Learning };
