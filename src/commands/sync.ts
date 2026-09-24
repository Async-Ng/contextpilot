import {
  EXIT_OK,
  out,
  requireHarness,
} from "../core/io";
import { runSync } from "../core/sync";
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
  const result = await runSync(harnessDir, {
    target: options.target,
    dryRun: preview,
    allowDriftOverwrite: true,
  });

  out(
    preview
      ? `Preview: ${result.written.length} file(s) would change, ${result.metadataRefreshed.length} baseline hash(es) would refresh, ${result.unchanged.length} already up to date. Size delta: ${result.sizeSummary.deltaBytes} bytes.`
      : `Synced ${result.written.length} file(s); refreshed ${result.metadataRefreshed.length} baseline hash(es); ${result.unchanged.length} unchanged.`,
    {
      status: preview ? "preview" : "synced",
      written: result.written,
      unchanged: result.unchanged,
      metadataRefreshed: result.metadataRefreshed,
      skipped: result.skipped,
      warnings: result.warnings,
      autoIngest,
      sizeSummary: result.sizeSummary,
    },
  );
  process.exit(EXIT_OK);
}
