import {
  EXIT_GENERAL,
  EXIT_OK,
  errOut,
  out,
  requireHarness,
} from "../core/io";
import {
  advanceRun,
  appendOrchestrationEvent,
  getActiveStep,
  getOrchestrationSummary,
} from "../core/orchestration";
import { runSync } from "../core/sync";

export const CHECKPOINT_NUDGE =
  "Run `contextpilot learn` if you learned something this session.";

/**
 * Session stop hook: sync agent targets and nudge the agent to record learnings.
 * Non-blocking - exit 0 unless sync fails.
 */
export async function runCheckpoint(): Promise<void> {
  const harnessDir = requireHarness();

  try {
    const result = await runSync(harnessDir, { allowDriftOverwrite: true });
    let orchestration = getOrchestrationSummary(harnessDir);
    let orchestrationNote: string | undefined;

    if (orchestration.activeRun && orchestration.activeStep) {
      const run = orchestration.activeRun;
      const step = orchestration.activeStep;
      appendOrchestrationEvent(harnessDir, {
        runId: run.id,
        stepId: step.id,
        type: "checkpoint",
        message: `Checkpoint synced ${result.written.length} file(s).`,
        data: {
          written: result.written.length,
          skipped: result.skipped.length,
          warnings: result.warnings.length,
        },
      });

      if (step.kind === "checkpoint") {
        const updated = await advanceRun(harnessDir, {
          status: "complete",
          note: `Auto-completed by contextpilot checkpoint (synced ${result.written.length} file(s)).`,
        });
        orchestrationNote =
          updated.status === "completed"
            ? `Orchestration run ${updated.id} completed automatically.`
            : `Orchestration run ${updated.id} advanced to its next step automatically.`;
        orchestration = {
          ...orchestration,
          activeRunId: updated.status === "completed" ? undefined : updated.id,
          activeRun: updated.status === "completed" ? undefined : updated,
          activeStep: updated.status === "completed" ? undefined : getActiveStep(updated),
        };
      } else {
        orchestrationNote =
          `Active orchestration run ${run.id} is at step "${step.title}" (not yet its final checkpoint step) - ` +
          `this checkpoint synced knowledge but did not advance the run. Call ` +
          `\`contextpilot orchestrate advance --status complete --note "<evidence>" --json\` for the current step when it's actually done.`;
      }
    }

    const humanLines = [`${CHECKPOINT_NUDGE}\nSynced ${result.written.length} file(s).`];
    if (orchestrationNote) {
      humanLines.push(orchestrationNote);
    }

    out(humanLines.join("\n"), {
      status: "checkpoint",
      synced: true,
      nudge: CHECKPOINT_NUDGE,
      written: result.written,
      skipped: result.skipped,
      warnings: result.warnings,
      orchestration,
      orchestrationNote,
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
