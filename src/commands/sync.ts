import {
  EXIT_DRIFT_UNRESOLVED,
  EXIT_OK,
  isInteractive,
  out,
  requireHarness,
} from "../core/io";
import { runSync } from "../core/sync";
import { computeStatus } from "../core/status-logic";
export interface SyncCommandOptions {
  target?: string;
  dryRun?: boolean;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<void> {
  const harnessDir = requireHarness();
  const status = computeStatus(harnessDir);

  if (
    status.drift.length > 0 &&
    isInteractive() &&
    !options.dryRun
  ) {
    out(
      `Unresolved drift in ${status.drift.length} file(s). Run \`contextpilot refresh\` first.`,
      { error: "drift_unresolved", drift: status.drift },
    );
    process.exit(EXIT_DRIFT_UNRESOLVED);
  }

  const result = await runSync(harnessDir, {
    target: options.target,
    dryRun: options.dryRun,
    allowDriftOverwrite: !isInteractive() || options.dryRun === true,
  });

  out(
    options.dryRun
      ? `Dry run: would write ${result.written.length} file(s).`
      : `Synced ${result.written.length} file(s).`,
    {
      status: options.dryRun ? "dry_run" : "synced",
      written: result.written,
      skipped: result.skipped,
      warnings: result.warnings,
    },
  );
  process.exit(EXIT_OK);
}
