import { resolveLearning } from "../core/memory";
import {
  EXIT_GENERAL,
  EXIT_OK,
  out,
  requireHarness,
} from "../core/io";
import { runSync } from "../core/sync";

export async function runResolve(id: string): Promise<void> {
  const harnessDir = requireHarness();
  const ok = await resolveLearning(harnessDir, id);
  if (!ok) {
    out(`Learning not found: ${id}`, { error: "not_found", id });
    process.exit(EXIT_GENERAL);
  }
  await runSync(harnessDir);
  out(`Archived learning: ${id}`, { status: "resolved", id });
  process.exit(EXIT_OK);
}
