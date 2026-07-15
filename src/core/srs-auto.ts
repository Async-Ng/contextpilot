import { loadConfig } from "./config-io";
import { getRuleFileDrift } from "./rules";
import { ingestSrs, type IngestResult } from "./srs";
import { getSrsFileDrift, type SrsFileDrift } from "./srs-state";
import { loadState } from "./state";

export interface AutoIngestSrsResult {
  status: "disabled" | "unchanged" | "ingested" | "skipped" | "failed";
  drift: SrsFileDrift[];
  reason?: string;
  result?: IngestResult;
}

export async function autoIngestSrsDrift(
  harnessDir: string,
): Promise<AutoIngestSrsResult> {
  const config = loadConfig(harnessDir);
  if (!config.srs.autoIngestOnDrift) {
    return { status: "disabled", drift: [] };
  }

  const drift = getSrsFileDrift(harnessDir);
  if (drift.length === 0) {
    return { status: "unchanged", drift };
  }

  const state = loadState(harnessDir);
  const ruleDrift = getRuleFileDrift(harnessDir, state);
  if (ruleDrift.length > 0) {
    return {
      status: "skipped",
      drift,
      reason: "rule_drift_conflict",
    };
  }

  try {
    const result = await ingestSrs(harnessDir, config.srs.path, true);
    return { status: "ingested", drift, result };
  } catch (error) {
    return {
      status: "failed",
      drift,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
