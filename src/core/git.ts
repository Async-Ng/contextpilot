import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { sha256 } from "./io";

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export interface GitWorktreeIdentity {
  projectRoot: string;
  worktreePath: string;
  branch?: string;
  baseRef?: string;
  baseCommit?: string;
}

export function getGitWorktreeIdentity(projectRoot: string): GitWorktreeIdentity {
  const worktreePath = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  const cwd = worktreePath ?? projectRoot;
  const branch = git(cwd, ["branch", "--show-current"]);
  const baseCommit = git(cwd, ["rev-parse", "HEAD"]);
  const baseRef = git(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  return {
    projectRoot: path.resolve(projectRoot),
    worktreePath: path.resolve(worktreePath ?? projectRoot),
    branch: branch || undefined,
    baseRef: baseRef || undefined,
    baseCommit: baseCommit || undefined,
  };
}

export function getGitDiff(harnessDir: string): string {
  const projectRoot = path.dirname(harnessDir);
  return git(projectRoot, ["diff", "--no-ext-diff", "--binary", "HEAD"]) ?? "";
}

export function getGitDiffDigest(harnessDir: string): string {
  return sha256(getGitDiff(harnessDir));
}

export function getChangedPaths(harnessDir: string): string[] {
  const projectRoot = path.dirname(harnessDir);
  const text = git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) ?? "";
  return text.split("\n").filter(Boolean).map((line) => line.slice(3).replace(/\\/g, "/"));
}
