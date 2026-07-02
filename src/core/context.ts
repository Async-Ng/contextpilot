import * as fs from "node:fs";
import { loadConfig, resolveProjectPath } from "./config-io";
import { writeAtomic } from "./io";

const PLACEHOLDER = "<!-- Set focus with: contextpilot focus \"your task\" -->";

export function readFocus(harnessDir: string): string {
  const config = loadConfig(harnessDir);
  const focusPath = resolveProjectPath(harnessDir, config.contextFile);
  if (!fs.existsSync(focusPath)) {
    return "";
  }
  const content = fs.readFileSync(focusPath, "utf8").trim();
  if (content === PLACEHOLDER) {
    return "";
  }
  return content;
}

export function writeFocus(harnessDir: string, text: string): void {
  const config = loadConfig(harnessDir);
  const focusPath = resolveProjectPath(harnessDir, config.contextFile);
  writeAtomic(focusPath, text);
}

export function initFocusFile(harnessDir: string): void {
  const config = loadConfig(harnessDir);
  const focusPath = resolveProjectPath(harnessDir, config.contextFile);
  writeAtomic(focusPath, `${PLACEHOLDER}\n`);
}

export { PLACEHOLDER };
