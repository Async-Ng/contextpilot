import {
  EXIT_OK,
  out,
  requireHarness,
} from "../core/io";
import { parseTimeout, runLongTask } from "../core/long-task";
import { getGlobalOptions } from "../core/globals";
import type { SyncResult } from "../core/sync";
import type { AutoIngestSrsResult } from "../core/srs-auto";
export interface SyncCommandOptions {
  target?: string;
  dryRun?: boolean;
  preview?: boolean;
  timeout?: string;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<void> {
  const harnessDir = requireHarness();
  const preview = options.preview === true || options.dryRun === true;
  const { autoIngest, ...result } = await runLongTask<SyncResult & { autoIngest: AutoIngestSrsResult }>("sync", {
    target: options.target,
    dryRun: preview,
    allowDriftOverwrite: true,
  }, parseTimeout(options.timeout));

  if (!getGlobalOptions().json) out(
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
