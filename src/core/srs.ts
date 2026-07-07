import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolveProjectPath } from "./config-io";
import { sha256, slugify, warn, withLock } from "./io";
import { appendLearning, autoResolveBySourceIds } from "./memory";
import { defaultFrontmatter, writeRule } from "./rules";
import { getStateFilePath, loadState, saveState } from "./state";
import { setSrsStateOnState } from "./srs-state";
import type { SrsFileEntry } from "./state-schema";
import { collectSrsSourceFiles, GLOBAL_SECTIONS } from "./srs-files";

function moduleNameFromFile(filePath: string, content: string): string {
  const heading = content.match(/^# .*?Module:\s*(.+)$/m);
  if (heading?.[1]) {
    return heading[1].trim();
  }
  const moduleHeading = content.match(/^##?\s+Module:\s*(.+)$/m);
  if (moduleHeading?.[1]) {
    return moduleHeading[1].trim();
  }
  const base = path.basename(filePath, ".md").replace(/^module-/, "");
  return base
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || base;
}

function extractModules(content: string): Array<{ name: string; body: string }> {
  const modules: Array<{ name: string; body: string }> = [];
  const parts = content.split(/^## Module: /m);
  if (parts.length <= 1) return modules;
  const first = parts[0];
  if (first) {
    // preamble before first module - ignore
  }
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const newlineIdx = part.indexOf("\n");
    const name = newlineIdx >= 0 ? part.slice(0, newlineIdx).trim() : part.trim();
    const body = newlineIdx >= 0 ? part.slice(newlineIdx + 1).trim() : "";
    modules.push({ name, body });
  }
  return modules;
}

function parseAppendixLearnings(
  content: string,
  moduleMap: Record<string, string[]>,
): Array<{
  sourceItemId: string;
  title: string;
  detail: string;
  severity: "low" | "med" | "high";
  scope: string[];
}> {
  const items: Array<{
    sourceItemId: string;
    title: string;
    detail: string;
    severity: "low" | "med" | "high";
    scope: string[];
  }> = [];

  const confirmationBlocks = content.match(
    /\[CONFIRMATION REQUIRED\][\s\S]*?(?=\n## |\n# |$)/gi,
  );
  if (confirmationBlocks) {
    for (const block of confirmationBlocks) {
      const idMatches = block.matchAll(/\b(FR|BR|UC|CAP)-\d+\b/g);
      for (const m of idMatches) {
        const sourceItemId = m[0];
        items.push({
          sourceItemId,
          title: `Unverified: ${sourceItemId} - confirm before implementing`,
          detail: block.trim().slice(0, 500),
          severity: "med",
          scope: moduleMap[sourceItemId] ?? ["**/*"],
        });
      }
    }
  }

  const qaSection = content.match(/Section QA Summary[\s\S]*$/i)?.[0] ?? "";
  const qaRows = qaSection.split("\n").filter((l) => l.includes("|"));
  for (const row of qaRows) {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const idCell = cells.find((c) => /^(FR|BR|UC|CAP)-\d+$/i.test(c));
    if (!idCell) continue;
    const sourceItemId = idCell.toUpperCase();
    const statusCell = cells.find((c) => /FAIL|WARN|PASS/i.test(c)) ?? "";
    let severity: "low" | "med" | "high" = "low";
    if (/FAIL/i.test(statusCell)) severity = "high";
    else if (/WARN/i.test(statusCell)) severity = "med";
    const name = cells[1] ?? sourceItemId;
    items.push({
      sourceItemId,
      title: `Unverified: ${sourceItemId} (${name}) - confirm before implementing`,
      detail: `QA status: ${statusCell}`,
      severity,
      scope: moduleMap[name] ?? ["**/*"],
    });
  }

  return items;
}

export interface IngestResult {
  knowledgeUpserted: number;
  learningsSeeded: number;
  autoResolved: number;
}

export async function ingestSrs(
  harnessDir: string,
  srsPath?: string,
  reingest = false,
): Promise<IngestResult> {
  const config = loadConfig(harnessDir);
  const projectRoot = path.dirname(harnessDir);
  const dir = srsPath
    ? path.resolve(projectRoot, srsPath)
    : resolveProjectPath(harnessDir, config.srs.path);

  if (!fs.existsSync(dir)) {
    throw new Error(`SRS directory not found: ${dir}`);
  }

  const files = collectSrsSourceFiles(dir);

  let knowledgeUpserted = 0;
  let learningsSeeded = 0;
  const presentSourceIds = new Set<string>();
  const fileHashes: Record<string, SrsFileEntry> = {};
  const ingestedAt = new Date().toISOString();

  const statePath = getStateFilePath(harnessDir);

  return withLock(statePath, () => {
    for (const file of files) {
      const sectionNum = file.sectionNum;
      const fullPath = file.fullPath;
      const content = fs.readFileSync(fullPath, "utf8");
      const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
      fileHashes[relPath] = { hash: sha256(content), ingestedAt };

      if (file.mode === "appendix") {
        const appendixItems = parseAppendixLearnings(content, config.srs.moduleMap);
        for (const item of appendixItems) {
          presentSourceIds.add(item.sourceItemId);
          const result = appendLearning(harnessDir, {
            category: "constraint",
            severity: item.severity,
            title: item.title,
            detail: item.detail,
            scope: item.scope,
            sourceItemId: item.sourceItemId,
          });
          if (result.status === "learned") learningsSeeded++;
        }
        continue;
      }

      if (file.mode === "nested-module") {
        const moduleName = moduleNameFromFile(fullPath, content);
        const moduleSlug = slugify(moduleName);
        const id = `srs-${sectionNum}-${moduleSlug}`;
        let scope = config.srs.moduleMap[moduleName];
        if (!scope) {
          scope = [`**/${moduleSlug}*`];
          warn(
            `No moduleMap entry for "${moduleName}"; using fallback scope **/${moduleSlug}*`,
          );
        }
        const fm = defaultFrontmatter(config, {
          id,
          title: `SRS ${sectionNum}: ${moduleName}`,
          type: "knowledge",
          scope,
          priority: "normal",
        });
        writeRule(harnessDir, id, fm, content);
        knowledgeUpserted++;
        continue;
      }

      if (file.mode === "legacy-module") {
        const modules = extractModules(content);
        for (const mod of modules) {
          const moduleSlug = slugify(mod.name);
          const id = `srs-${sectionNum}-${moduleSlug}`;
          let scope = config.srs.moduleMap[mod.name];
          if (!scope) {
            scope = [`**/${moduleSlug}*`];
            warn(
              `No moduleMap entry for "${mod.name}"; using fallback scope **/${moduleSlug}*`,
            );
          }
          const fm = defaultFrontmatter(config, {
            id,
            title: `SRS ${sectionNum}: ${mod.name}`,
            type: "knowledge",
            scope,
            priority: "normal",
          });
          writeRule(harnessDir, id, fm, mod.body);
          knowledgeUpserted++;
        }
        continue;
      }

      if (file.mode === "global" && GLOBAL_SECTIONS.has(sectionNum)) {
        const id = `srs-${sectionNum}`;
        const priority = sectionNum === "01" || sectionNum === "02" ? "low" : "normal";
        const fm = defaultFrontmatter(config, {
          id,
          title: `SRS Section ${sectionNum}`,
          type: "knowledge",
          scope: ["**/*"],
          priority,
        });
        writeRule(harnessDir, id, fm, content);
        knowledgeUpserted++;
      }
    }

    let autoResolved = 0;
    if (reingest) {
      autoResolved = autoResolveBySourceIds(harnessDir, presentSourceIds);
    }

    const state = loadState(harnessDir);
    setSrsStateOnState(
      state,
      "ingested",
      path.relative(projectRoot, dir).replace(/\\/g, "/"),
    );
    state.srs.files = fileHashes;
    saveState(harnessDir, state);

    return { knowledgeUpserted, learningsSeeded, autoResolved };
  });
}
