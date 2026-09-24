import * as fs from "node:fs";
import { EXIT_OK, out, requireHarness, sha256File } from "../core/io";
import { runSync } from "../core/sync";
import { loadState, resolveStatePathKey } from "../core/state";

/** Explain the same reconciliation plan that sync would apply, without writing. */
export async function runDiagnoseDrift(): Promise<void> {
  const harnessDir = requireHarness();
  const state = loadState(harnessDir);
  const preview = await runSync(harnessDir, { dryRun: true, allowDriftOverwrite: true });
  const paths = [...preview.written, ...preview.metadataRefreshed, ...preview.unchanged];
  const artifacts = paths.map((path) => {
    const key = Object.keys(state.generated).find((candidate) => resolveStatePathKey(harnessDir, candidate) === path);
    const actualHash = fs.existsSync(path) ? sha256File(path) ?? undefined : undefined;
    const recordedHash = key ? state.generated[key]?.hash : undefined;
    const artifactState = preview.written.includes(path)
      ? (fs.existsSync(path) ? "content_drift" : "missing")
      : preview.metadataRefreshed.includes(path)
        ? "metadata_stale"
        : "in_sync";
    return {
      path,
      state: artifactState,
      action: artifactState === "in_sync" ? "none" : artifactState === "metadata_stale" ? "refresh_metadata" : "regenerate",
      recordedHash,
      actualHash,
      expectedHash: preview.expectedHashes[path],
    };
  });
  out(
    `Generated artifact diagnosis: ${artifacts.filter((item) => item.state !== "in_sync").length} action(s) needed.`,
    { health: artifacts.some((item) => item.state !== "in_sync") ? "degraded" : "healthy", artifacts },
  );
  process.exit(EXIT_OK);
}
