import { EXIT_OK, out, requireHarness } from "../core/io";
import { reconcileGeneratedArtifacts } from "../core/sync";

/** Explain the same reconciliation plan that sync would apply, without writing. */
export async function runDiagnoseDrift(options: { all?: boolean } = {}): Promise<void> {
  const harnessDir = requireHarness();
  const all = reconcileGeneratedArtifacts(harnessDir);
  const artifacts = options.all ? all : all.filter((item) => item.state !== "in_sync");
  out(
    `Generated artifact diagnosis: ${artifacts.filter((item) => item.state !== "in_sync").length} action(s) needed.`,
    { health: all.some((item) => item.state !== "in_sync") ? "degraded" : "healthy", artifacts },
  );
  process.exit(EXIT_OK);
}
