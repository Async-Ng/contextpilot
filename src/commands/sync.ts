import {
  EXIT_DRIFT_UNRESOLVED,
  EXIT_OK,
  isInteractive,
  out,
  requireHarness,
} from "../core/io";
import { runSync } from "../core/sync";
import { computeStatus } from "../core/status-logic";
import { autoIngestSrsDrift } from "../core/srs-auto";
export interface SyncCommandOptions {
  target?: string;
  dryRun?: boolean;
  preview?: boolean;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<void> {
  const harnessDir = requireHarness();
  const preview = options.preview === true || options.dryRun === true;
  const autoIngest = await autoIngestSrsDrift(harnessDir);
  const status = computeStatus(harnessDir, { fast: preview });

  if (
    status.drift.length > 0 &&
    isInteractive() &&
    !preview
  ) {
    out(
      `Unresolved drift in ${status.drift.length} file(s). Run \`contextpilot refresh\` first.`,
      { error: "drift_unresolved", drift: status.drift },
    );
    process.exit(EXIT_DRIFT_UNRESOLVED);
  }

  const result = await runSync(harnessDir, {
    target: options.target,
    dryRun: preview,
    allowDriftOverwrite: !isInteractive() || preview,
  });

  out(
    preview
      ? `Preview: ${result.written.length} file(s) would change, ${result.unchanged.length} already up to date. Size delta: ${result.sizeSummary.deltaBytes} bytes.`
      : `Synced ${result.written.length} file(s); ${result.unchanged.length} unchanged.`,
    {
      status: preview ? "preview" : "synced",
      written: result.written,
      unchanged: result.unchanged,
      skipped: result.skipped,
      warnings: result.warnings,
      autoIngest,
      sizeSummary: result.sizeSummary,
    },
  );
  process.exit(EXIT_OK);
}
