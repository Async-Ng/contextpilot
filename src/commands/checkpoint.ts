import {
  EXIT_GENERAL,
  EXIT_OK,
  errOut,
  out,
  requireHarness,
} from "../core/io";
import {
  appendOrchestrationEvent,
  getOrchestrationSummary,
} from "../core/orchestration";
import { runSync } from "../core/sync";

export const CHECKPOINT_NUDGE =
  "Run `contextpilot learn` if you learned something this session.";

/**
 * Session stop hook: sync agent targets and nudge the agent to record learnings.
 * Non-blocking â€” exit 0 unless sync fails.
 */
export async function runCheckpoint(): Promise<void> {
  const harnessDir = requireHarness();

  try {
    const result = await runSync(harnessDir, { allowDriftOverwrite: true });
    const orchestration = getOrchestrationSummary(harnessDir);
    if (orchestration.activeRun) {
      appendOrchestrationEvent(harnessDir, {
        runId: orchestration.activeRun.id,
        stepId: orchestration.activeStep?.id,
        type: "checkpoint",
        message: `Checkpoint synced ${result.written.length} file(s).`,
        data: {
          written: result.written.length,
          skipped: result.skipped.length,
          warnings: result.warnings.length,
        },
      });
    }
    out(`${CHECKPOINT_NUDGE}\nSynced ${result.written.length} file(s).`, {
      status: "checkpoint",
      synced: true,
      nudge: CHECKPOINT_NUDGE,
      written: result.written,
      skipped: result.skipped,
      warnings: result.warnings,
      orchestration,
    });
    process.exit(EXIT_OK);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errOut(`Checkpoint sync failed: ${message}`, {
      status: "checkpoint",
      synced: false,
      error: message,
    });
    process.exit(EXIT_GENERAL);
  }
}
