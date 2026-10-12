import { fork, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getGlobalOptions } from "./globals";
import { getStateFilePath } from "./state";

export type LongTaskName = "sync" | "verify";
export const DEFAULT_TIMEOUT_SECONDS = 120;

export function parseTimeout(value: string | undefined): number {
  const seconds = value === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error("--timeout must be a positive integer in seconds. Example: --timeout 120");
  }
  return seconds;
}

export function runLongTask<T>(task: LongTaskName, payload: object, timeoutSeconds: number): Promise<T> {
  const harnessDir = path.join(getGlobalOptions().cwd, ".contextpilot");
  const logDir = path.join(harnessDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${task}-${Date.now()}-${process.pid}.jsonl`);
  const child = fork(path.join(__dirname, "long-task-worker.js"), [], { cwd: getGlobalOptions().cwd, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const json = getGlobalOptions().json;
  let lastStep = "start";
  let ownsStateLock = false;
  let settled = false;
  let terminating = false;
  let timer: NodeJS.Timeout;
  const event = (type: string, details: object = {}) => {
    const record = { type, task, time: new Date().toISOString(), pid: child.pid, step: lastStep, ...details };
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    if (json) process.stdout.write(`${JSON.stringify(record)}\n`);
    else if (type === "progress") process.stderr.write(`[${task}] ${lastStep}\n`);
  };
  const killTree = async () => {
    if (!child.pid) return;
    terminating = true;
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      });
    } else {
      child.kill("SIGKILL");
      if (child.exitCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    if (ownsStateLock) {
      try {
        fs.rmSync(`${getStateFilePath(harnessDir)}.lock`, { recursive: true, force: true });
      } catch (error) {
        event("progress", { cleanupWarning: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  return new Promise<T>((resolve, reject) => {
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
      if (error) {
        event("error", { message: error.message, logPath });
        reject(error);
      } else {
        event("done", { result, logPath });
        resolve(result as T);
      }
    };
    const cancel = async () => {
      await killTree();
      finish(new Error(`Canceled at ${lastStep}. Log: ${logPath}`));
    };
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    child.stdout?.on("data", (chunk: Buffer) => fs.appendFileSync(logPath, chunk));
    child.stderr?.on("data", (chunk: Buffer) => fs.appendFileSync(logPath, chunk));
    child.on("message", (message: unknown) => {
      const data = message as { type?: string; step?: string; result?: T; message?: string };
      if (data.type === "progress" && data.step) {
        lastStep = data.step;
        if (lastStep === "state lock acquired") ownsStateLock = true;
        event("progress");
      } else if (data.type === "done") finish(undefined, data.result);
      else if (data.type === "error") finish(new Error(`${data.message ?? "Worker failed"}. Last step: ${lastStep}. Log: ${logPath}`));
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => { if (!terminating) finish(new Error(`Worker exited with code ${code}. Last step: ${lastStep}. Log: ${logPath}`)); });
    timer = setTimeout(async () => {
      await killTree();
      finish(new Error(`Timed out after ${timeoutSeconds}s at ${lastStep}. Log: ${logPath}`));
    }, timeoutSeconds * 1000);
    event("start", { timeoutSeconds, logPath });
    child.send({ task, payload });
  });
}
