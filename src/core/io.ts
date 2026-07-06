import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import lockfile from "proper-lockfile";
import { getGlobalOptions } from "./globals";

export const EXIT_OK = 0;
export const EXIT_GENERAL = 1;
export const EXIT_MISSING_FLAG = 2;
export const EXIT_REQUIRES_HUMAN = 3;
export const EXIT_DRIFT_UNRESOLVED = 4;
export const CONTEXTPILOT_DIR = ".contextpilot";
export const LEGACY_HARNESS_DIR = ".harness";

export function isInteractive(): boolean {
  const opts = getGlobalOptions();
  return process.stdout.isTTY === true && !opts.noInput;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  return sha256(content);
}

export function writeAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function appendLine(filePath: string, line: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

export function getHarnessDir(cwd?: string): string {
  return path.join(cwd ?? getGlobalOptions().cwd, CONTEXTPILOT_DIR);
}

export function getLegacyHarnessDir(cwd?: string): string {
  return path.join(cwd ?? getGlobalOptions().cwd, LEGACY_HARNESS_DIR);
}

export function requireHarness(cwd?: string): string {
  const harnessDir = getHarnessDir(cwd);
  const configPath = path.join(harnessDir, "harness.config.json");
  if (!fs.existsSync(configPath)) {
    const opts = getGlobalOptions();
    const msg = {
      error: "not_initialized",
      hint: "Run `contextpilot setup` first to create .contextpilot/",
    };
    if (opts.json) {
      console.log(JSON.stringify(msg));
    } else {
      console.error(chalk.red("ContextPilot not initialized. Run `contextpilot setup` first."));
    }
    process.exit(EXIT_GENERAL);
  }
  return harnessDir;
}

export async function withLock<T>(
  stateFilePath: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const dir = path.dirname(stateFilePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(stateFilePath)) {
    fs.writeFileSync(stateFilePath, "{}\n", "utf8");
  }
  const release = await lockfile.lock(stateFilePath, {
    retries: {
      retries: 5,
      minTimeout: 100,
      maxTimeout: 1000,
    },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export function out(human: string, jsonObj: unknown): void {
  const opts = getGlobalOptions();
  if (opts.json) {
    console.log(JSON.stringify(jsonObj, null, 2));
  } else {
    console.log(human);
  }
}

export function errOut(human: string, jsonObj: unknown): void {
  const opts = getGlobalOptions();
  if (opts.json) {
    console.error(JSON.stringify(jsonObj, null, 2));
  } else {
    console.error(chalk.red(human));
  }
}

export function exitMissingFlag(flag: string, hint: string): never {
  const jsonObj = { error: "missing_flag" as const, flag, hint };
  errOut(`Missing required flag ${flag}. ${hint}`, jsonObj);
  process.exit(EXIT_MISSING_FLAG);
}

export function exitRequiresHuman(cmd: string): never {
  const jsonObj = {
    error: "requires_human" as const,
    hint: `ask the user to run \`contextpilot ${cmd}\` manually`,
  };
  errOut(`Command \`${cmd}\` requires human interaction.`, jsonObj);
  process.exit(EXIT_REQUIRES_HUMAN);
}

export function warn(message: string): void {
  const opts = getGlobalOptions();
  if (opts.json) {
    return;
  }
  console.warn(chalk.yellow(`Warning: ${message}`));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

/** Expand a leading `~` to the user home directory. */
export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
