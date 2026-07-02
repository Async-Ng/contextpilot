import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import { loadConfig, resolveProjectPath } from "./config-io";
import { slugify } from "./io";
import { defaultFrontmatter, writeRule } from "./rules";

const LIKELY_NAME_PATTERNS =
  /convention|rule|standard|guideline|business|logic|domain|architecture|pattern|contributing/i;

const LIKELY_CONTENT_PATTERNS =
  /phải|không được|must|never|always|forbidden|convention|✅|❌/i;

export interface ScanCandidate {
  path: string;
  relativePath: string;
  classification: "likely" | "uncertain";
  preSelected: boolean;
  preview: string;
}

export function classifyFile(filePath: string): "likely" | "uncertain" {
  const baseName = path.basename(filePath);
  if (LIKELY_NAME_PATTERNS.test(baseName)) {
    return "likely";
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (LIKELY_CONTENT_PATTERNS.test(content)) {
      return "likely";
    }
  } catch {
    return "uncertain";
  }
  return "uncertain";
}

export function scanDocs(harnessDir: string): ScanCandidate[] {
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();

  for (const include of config.scan.include) {
    const files = fg.sync(include, {
      cwd: projectRoot,
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
      deep: config.scan.maxDepth,
      ignore: config.scan.exclude.map((e) => `**/${e}/**`),
    });

    for (const filePath of files) {
      if (!filePath.endsWith(".md")) continue;
      const rel = path.relative(projectRoot, filePath);
      for (const excl of config.scan.exclude) {
        if (rel.includes(excl)) continue;
      }
      if (seen.has(filePath)) continue;
      seen.add(filePath);

      const classification = classifyFile(filePath);
      let preview = "";
      try {
        preview = fs.readFileSync(filePath, "utf8").slice(0, 300);
      } catch {
        continue;
      }

      candidates.push({
        path: filePath,
        relativePath: rel,
        classification,
        preSelected: classification === "likely",
        preview,
      });
    }
  }

  return candidates;
}

export function importScanFile(
  harnessDir: string,
  filePath: string,
  type: "rule" | "knowledge" = "knowledge",
): string {
  const config = loadConfig(harnessDir);
  const content = fs.readFileSync(filePath, "utf8");
  const baseName = path.basename(filePath, ".md");
  const id = slugify(baseName);
  const fm = defaultFrontmatter(config, {
    id,
    title: baseName,
    type,
    scope: [`${path.dirname(path.relative(path.dirname(harnessDir), filePath))}/**`],
  });
  writeRule(harnessDir, id, fm, content);
  return id;
}

export function importScanCandidates(
  harnessDir: string,
  candidates: ScanCandidate[],
): string[] {
  const imported: string[] = [];
  for (const c of candidates) {
    const id = importScanFile(harnessDir, c.path);
    imported.push(id);
  }
  return imported;
}
