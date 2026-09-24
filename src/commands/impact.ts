import { EXIT_OK, out, requireHarness, exitMissingFlag } from "../core/io";
import { analyzeImpact } from "../core/impact";
export function runImpact(options: { file?: string[]; depth?: string; all?: boolean }): void {
  if (!options.file?.length) exitMissingFlag("--file", "Provide one or more changed JS/TS files.");
  const report = analyzeImpact(requireHarness(), options.file, options.all ? Number.MAX_SAFE_INTEGER : Number(options.depth ?? 2));
  out(`Impact: ${report.directDependents.length} direct, ${report.transitiveDependents.length} transitive dependents.`, report);
  process.exit(EXIT_OK);
}
