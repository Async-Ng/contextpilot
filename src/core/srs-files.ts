import * as fs from "node:fs";
import * as path from "node:path";

export const MODULE_SECTIONS = new Set(["03", "06", "07", "08"]);
export const GLOBAL_SECTIONS = new Set(["01", "02", "04", "05", "09", "10", "11"]);
export const APPENDIX_SECTION = "12";

export function parseSectionNumber(filename: string): string | null {
  const match = /^(\d{2})-/.exec(path.basename(filename));
  return match?.[1] ?? null;
}

export interface SrsSourceFile {
  sectionNum: string;
  fullPath: string;
  mode: "global" | "legacy-module" | "nested-module" | "appendix";
}

/**
 * Shared SRS source-file discovery, used by both ingestion (`srs.ts`) and
 * drift detection (`srs-state.ts`) so the two never disagree about which
 * files count as "the SRS".
 */
export function collectSrsSourceFiles(dir: string): SrsSourceFile[] {
  const files: SrsSourceFile[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && /^\d{2}-.*\.md$/.test(entry.name)) {
      const sectionNum = parseSectionNumber(entry.name);
      if (!sectionNum) continue;
      files.push({
        sectionNum,
        fullPath,
        mode: sectionNum === APPENDIX_SECTION
          ? "appendix"
          : MODULE_SECTIONS.has(sectionNum)
            ? "legacy-module"
            : "global",
      });
      continue;
    }

    if (!entry.isDirectory()) continue;
    const sectionNum = parseSectionNumber(entry.name);
    if (!sectionNum || !MODULE_SECTIONS.has(sectionNum)) continue;

    const moduleFiles = fs
      .readdirSync(fullPath)
      .filter((f) => /^module-.+\.md$/.test(f))
      .sort();
    for (const moduleFile of moduleFiles) {
      files.push({
        sectionNum,
        fullPath: path.join(fullPath, moduleFile),
        mode: "nested-module",
      });
    }
  }

  return files.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}
