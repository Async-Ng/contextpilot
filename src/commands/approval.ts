import { decideApproval } from "../core/approvals";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";

export function runApprovalDecision(options: { request?: string; reason?: string }, grant: boolean): void {
  const harnessDir = requireHarness();
  if (!options.request) {
    errOut("Missing required flag --request.", { error: "missing_flag", flag: "--request" });
    process.exit(EXIT_GENERAL);
  }
  try {
    const approval = decideApproval(harnessDir, options.request, grant, options.reason);
    out(`Approval ${grant ? "granted" : "denied"}: ${approval.id}`, { status: approval.status, approval });
    process.exit(EXIT_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errOut(message, { error: "approval_failed", message });
    process.exit(EXIT_GENERAL);
  }
}
