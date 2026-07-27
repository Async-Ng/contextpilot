import * as fs from "node:fs";
import { loadConfig, resolveProjectPath } from "./config-io";
import { writeAtomic } from "./io";
import { getRuntimeActiveRunId } from "./runtime";

const PLACEHOLDER = "<!-- Set focus with: contextpilot focus \"your task\" -->";

export interface FocusMetadata {
  updatedAt: string;
  runId?: string;
  expiresAt?: string;
}

export interface FocusInfo {
  text: string;
  metadata?: FocusMetadata;
  stale: boolean;
  staleReason?: string;
}

function getFocusPath(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  return resolveProjectPath(harnessDir, config.contextFile);
}

function getFocusMetaPath(harnessDir: string): string {
  return `${getFocusPath(harnessDir)}.meta.json`;
}

function readRawFocus(harnessDir: string): string {
  const focusPath = getFocusPath(harnessDir);
  if (!fs.existsSync(focusPath)) {
    return "";
  }
  const content = fs.readFileSync(focusPath, "utf8").trim();
  if (content === PLACEHOLDER) {
    return "";
  }
  return content;
}

function readFocusMetadata(harnessDir: string): FocusMetadata | undefined {
  const metaPath = getFocusMetaPath(harnessDir);
  if (!fs.existsSync(metaPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as FocusMetadata;
  } catch {
    return undefined;
  }
}

export function readFocusInfo(harnessDir: string): FocusInfo {
  const text = readRawFocus(harnessDir);
  if (!text) {
    return { text: "", stale: false };
  }
  const metadata = readFocusMetadata(harnessDir);
  if (metadata?.expiresAt && Date.now() > new Date(metadata.expiresAt).getTime()) {
    return { text, metadata, stale: true, staleReason: "expired" };
  }
  const activeRunId = getRuntimeActiveRunId(harnessDir);
  if (metadata?.runId && metadata.runId !== activeRunId) {
    return { text, metadata, stale: true, staleReason: "inactive_run" };
  }
  return { text, metadata, stale: false };
}

export function readFocus(harnessDir: string): string {
  const info = readFocusInfo(harnessDir);
  return info.stale ? "" : info.text;
}

export function writeFocus(harnessDir: string, text: string): void {
  const config = loadConfig(harnessDir);
  const updatedAt = new Date();
  const expiresAt = new Date(updatedAt.getTime() + config.context.focusTtlHours * 60 * 60 * 1000);
  const metadata: FocusMetadata = {
    updatedAt: updatedAt.toISOString(),
    runId: getRuntimeActiveRunId(harnessDir),
    expiresAt: expiresAt.toISOString(),
  };
  writeAtomic(getFocusPath(harnessDir), text);
  writeAtomic(getFocusMetaPath(harnessDir), `${JSON.stringify(metadata, null, 2)}\n`);
}

export function initFocusFile(harnessDir: string): void {
  writeAtomic(getFocusPath(harnessDir), `${PLACEHOLDER}\n`);
}

export { PLACEHOLDER };
