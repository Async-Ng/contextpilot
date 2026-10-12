import * as path from "node:path";
import { runSync, type SyncOptions } from "./sync";
import { autoIngestSrsDrift } from "./srs-auto";
import { runVerification } from "./orchestration";
import { getActiveStep } from "./orchestration";

process.on("message", async (message: unknown) => {
  const { task, payload } = message as { task: "sync" | "verify"; payload: Record<string, unknown> };
  const harnessDir = path.join(process.cwd(), ".contextpilot");
  const progress = (step: string) => process.send?.({ type: "progress", step });
  try {
    if (task === "sync") {
      progress("checking SRS drift");
      const autoIngest = await autoIngestSrsDrift(harnessDir);
      progress("reconciling generated files");
      const result = await runSync(harnessDir, { ...(payload as SyncOptions), onLockAcquired: () => progress("state lock acquired") });
      process.send?.({ type: "done", result: { status: payload.dryRun ? "preview" : "synced", ...result, autoIngest } }, () => process.disconnect());
    } else if (task === "verify") {
      progress("running verification commands");
      const run = await runVerification(harnessDir, payload.expectedRevision as number | undefined, (command) => progress(`verify: ${command}`));
      process.send?.({ type: "done", result: { status: "verification_recorded", run, activeStep: getActiveStep(run) } }, () => process.disconnect());
    } else throw new Error(`Unknown task: ${task}`);
  } catch (error) {
    process.send?.({ type: "error", message: error instanceof Error ? error.message : String(error) }, () => process.disconnect());
  }
});
