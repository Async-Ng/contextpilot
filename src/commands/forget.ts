import * as p from "@clack/prompts";
import chalk from "chalk";
import { forgetLearning } from "../core/memory";
import {
  EXIT_GENERAL,
  EXIT_OK,
  exitRequiresHuman,
  isInteractive,
  out,
  requireHarness,
} from "../core/io";
import { runSync } from "../core/sync";

export async function runForget(id: string): Promise<void> {
  if (!isInteractive()) {
    exitRequiresHuman("forget");
  }

  const harnessDir = requireHarness();

  const confirm = await p.confirm({
    message: `Permanently delete learning ${id}? This cannot be undone.`,
    initialValue: false,
  });
  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Forget cancelled.");
    process.exit(EXIT_OK);
  }

  const ok = await forgetLearning(harnessDir, id);
  if (!ok) {
    out(`Learning not found: ${id}`, { error: "not_found", id });
    process.exit(EXIT_GENERAL);
  }

  await runSync(harnessDir);
  out(`Deleted learning: ${id}`, { status: "forgotten", id });
  p.outro(chalk.green("Done."));
  process.exit(EXIT_OK);
}
