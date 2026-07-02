import * as p from "@clack/prompts";
import { adoptExternalItems } from "../core/adopt";
import { scanDiscoverItems } from "../core/discover";
import {
  EXIT_DRIFT_UNRESOLVED,
  exitRequiresHuman,
  isInteractive,
  warn,
} from "../core/io";
import { computeStatus } from "../core/status-logic";
import { runSync } from "../core/sync";

export interface RefreshOptions {
  auto?: boolean;
  dryRun?: boolean;
}

export interface RefreshResult {
  adopted: string[];
  skillsSeen: string[];
  driftKept: string[];
}

export async function refreshHarness(
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const { requireHarness } = await import("../core/io");
  const harnessDir = requireHarness();
  const report = computeStatus(harnessDir);
  const adopted: string[] = [];
  const skillsSeen: string[] = [];
  const driftKept: string[] = [];

  const autoMode = options.auto === true || !isInteractive();

  for (const d of report.drift) {
    if (autoMode) {
      driftKept.push(d.path);
      warn(`Keeping external drift at ${d.path} (policy: keep)`);
      continue;
    }

    const action = await p.select({
      message: `Drift detected: ${d.path}`,
      options: [
        { value: "diff", label: "Show diff info" },
        { value: "adopt", label: "Adopt external into .contextpilot" },
        { value: "keep", label: "Keep external, regenerate from .contextpilot" },
        { value: "skip", label: "Skip" },
      ],
    });

    if (p.isCancel(action)) continue;

    if (action === "adopt") {
      exitRequiresHuman("refresh (drift adopt)");
    }
    if (action === "keep" || action === "diff") {
      driftKept.push(d.path);
    }
  }

  if (report.newExternal.length > 0 || report.newSkills.length > 0) {
    const items = scanDiscoverItems(harnessDir);
    const toAdopt = items.filter(
      (i) =>
        report.newExternal.some((e) => e.path === i.path) ||
        report.newSkills.some((s) => s.path === i.path),
    );

    if (autoMode) {
      const result = await adoptExternalItems(harnessDir, toAdopt);
      adopted.push(...result.adopted);
      skillsSeen.push(...result.skillsSeen);
    } else if (isInteractive()) {
      const confirm = await p.confirm({
        message: `Adopt ${toAdopt.length} new external item(s)?`,
        initialValue: true,
      });
      if (!p.isCancel(confirm) && confirm) {
        const result = await adoptExternalItems(harnessDir, toAdopt);
        adopted.push(...result.adopted);
        skillsSeen.push(...result.skillsSeen);
      }
    }
  }

  if (options.dryRun) {
    return { adopted, skillsSeen, driftKept };
  }

  const unresolvedDrift = report.drift.filter(
    (d) => !driftKept.includes(d.path),
  );
  if (unresolvedDrift.length > 0 && isInteractive() && !autoMode) {
    const { out } = await import("../core/io");
    out("Unresolved drift remains.", { drift: unresolvedDrift });
    process.exit(EXIT_DRIFT_UNRESOLVED);
  }

  await runSync(harnessDir, { allowDriftOverwrite: true });
  return { adopted, skillsSeen, driftKept };
}
