import * as fs from "node:fs";
import * as path from "node:path";
import { nanoid } from "nanoid";
import { getGitDiffDigest } from "./git";
import { appendLine } from "./io";
import { getRuntimeDir } from "./runtime";

export interface ApprovalRequest {
  id: string;
  runId: string;
  command: string;
  risk: "network" | "destructive";
  status: "pending" | "granted" | "denied" | "expired";
  diffDigest: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  reason?: string;
}

function approvalsPath(harnessDir: string): string {
  return path.join(getRuntimeDir(harnessDir), "approvals.jsonl");
}

export function listApprovals(harnessDir: string): ApprovalRequest[] {
  const file = approvalsPath(harnessDir);
  if (!fs.existsSync(file)) return [];
  const latest = new Map<string, ApprovalRequest>();
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    try {
      const approval = JSON.parse(line) as ApprovalRequest;
      latest.set(approval.id, approval);
    } catch {
      // Corrupt runtime approvals must not block project work.
    }
  }
  return [...latest.values()];
}

export function requestApproval(harnessDir: string, runId: string, command: string, risk: "network" | "destructive"): ApprovalRequest {
  const createdAt = new Date();
  const diffDigest = getGitDiffDigest(harnessDir);
  const existing = listApprovals(harnessDir).find((approval) =>
    approval.runId === runId && approval.command === command && approval.risk === risk
      && approval.status === "pending" && approval.diffDigest === diffDigest
      && new Date(approval.expiresAt).getTime() >= createdAt.getTime(),
  );
  if (existing) return existing;
  const approval: ApprovalRequest = {
    id: `approval_${nanoid(8)}`,
    runId,
    command,
    risk,
    status: "pending",
    diffDigest,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000).toISOString(),
  };
  appendLine(approvalsPath(harnessDir), JSON.stringify(approval));
  return approval;
}

export function decideApproval(harnessDir: string, id: string, grant: boolean, reason?: string): ApprovalRequest {
  const current = listApprovals(harnessDir).find((item) => item.id === id);
  if (!current) throw new Error(`Approval request not found: ${id}`);
  const updated: ApprovalRequest = {
    ...current,
    status: grant ? "granted" : "denied",
    decidedAt: new Date().toISOString(),
    reason,
  };
  appendLine(approvalsPath(harnessDir), JSON.stringify(updated));
  return updated;
}

export function findValidApproval(harnessDir: string, runId: string, command: string): ApprovalRequest | undefined {
  const now = Date.now();
  const diffDigest = getGitDiffDigest(harnessDir);
  return listApprovals(harnessDir).find((approval) =>
    approval.runId === runId && approval.command === command && approval.status === "granted"
      && new Date(approval.expiresAt).getTime() >= now && approval.diffDigest === diffDigest,
  );
}
