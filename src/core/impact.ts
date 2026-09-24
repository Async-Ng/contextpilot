import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import { listOpenDecisions } from "./decisions";
import { queryKnowledge } from "./knowledge";
import { getOrchestrationSummary } from "./orchestration";
import { getRuntimeDir } from "./runtime";
import { writeAtomic } from "./io";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const IMPORT = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
const isTest = (file: string) => /(?:\.test|\.spec)\.[jt]sx?$|(?:^|\/)__tests__\//.test(file);
const normalize = (root: string, file: string) => path.relative(root, file).replace(/\\/g, "/");

interface CachedGraph { fingerprint: string; files: string[]; reverse: Map<string, Set<string>>; unknown: string[]; }
let graphCache: CachedGraph | undefined;

function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, ...EXTENSIONS.map((ext) => `${base}${ext}`), ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function graphFor(harnessDir: string, root: string): CachedGraph {
  const files = fg.sync(["**/*.{ts,tsx,js,jsx}"], {
    cwd: root, ignore: ["node_modules/**", "dist/**", "build/**", ".contextpilot/**"],
  }).map((file) => path.join(root, file));
  const fingerprint = files.map((file) => {
    const stat = fs.statSync(file);
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  }).join("|");
  if (graphCache?.fingerprint === fingerprint) return graphCache;
  const cachePath = path.join(getRuntimeDir(harnessDir), "impact-graph.json");
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as { fingerprint: string; reverse: Record<string, string[]>; unknown: string[] };
    if (cached.fingerprint === fingerprint) {
      const reverse = new Map(Object.entries(cached.reverse).map(([file, dependents]) => [file, new Set(dependents)]));
      return graphCache = { fingerprint, files, reverse, unknown: cached.unknown };
    }
  } catch { /* cache absent or stale: rebuild */ }
  const reverse = new Map<string, Set<string>>();
  const unknown: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    IMPORT.lastIndex = 0;
    for (let match; (match = IMPORT.exec(text));) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const target = resolveImport(file, specifier);
      if (target) (reverse.get(target) ?? reverse.set(target, new Set()).get(target)!).add(file);
      else if (specifier.startsWith(".")) unknown.push(`${normalize(root, file)} -> ${specifier}`);
    }
  }
  const graph = { fingerprint, files, reverse, unknown };
  try {
    writeAtomic(cachePath, `${JSON.stringify({ fingerprint, reverse: Object.fromEntries([...reverse].map(([file, dependents]) => [file, [...dependents]])), unknown })}\n`);
  } catch { /* impact remains read-only if runtime storage is unavailable */ }
  return graphCache = graph;
}

function matchesScope(file: string, scope: string): boolean {
  const prefix = scope.replace(/\*.*$/, "");
  return !prefix || file.startsWith(prefix);
}

export interface ImpactReport {
  changed: string[];
  directDependents: string[];
  transitiveDependents: string[];
  relatedTests: string[];
  knowledge: Array<{ id: string; title: string }>;
  openDecisions: Array<{ id: string; question: string }>;
  suggestedScope: string[];
  outsideActiveScope: string[];
  risk: "low" | "medium" | "high";
  unknown: string[];
}

export function analyzeImpact(harnessDir: string, input: string[], depth = 2): ImpactReport {
  const root = path.dirname(harnessDir);
  const graph = graphFor(harnessDir, root);
  const { files, reverse, unknown } = graph;
  const changed = input.map((file) => normalize(root, path.resolve(root, file)));
  const queue = changed.map((file) => ({ file: path.join(root, file), distance: 0 }));
  const direct = new Set<string>(), transitive = new Set<string>(), seen = new Set(queue.map((item) => item.file));
  while (queue.length) {
    const current = queue.shift()!;
    if (current.distance >= depth) continue;
    for (const dependent of reverse.get(current.file) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent); queue.push({ file: dependent, distance: current.distance + 1 });
      (current.distance === 0 ? direct : transitive).add(normalize(root, dependent));
    }
  }
  const impacted = [...new Set([...changed, ...direct, ...transitive])];
  const relatedTests = files.filter((file) => isTest(normalize(root, file)) && (impacted.includes(normalize(root, file)) || [...reverse.get(file) ?? []].some((item) => impacted.includes(normalize(root, item))))).map((file) => normalize(root, file));
  const knowledge = queryKnowledge(harnessDir, { files: impacted, task: "code", limit: 10 }).results.map((item) => ({ id: item.id, title: item.title }));
  const openDecisions = listOpenDecisions(harnessDir).filter((decision) => decision.scopes.some((scope) => impacted.some((file) => scope.replace("**", "").replace("*", "") && file.startsWith(scope.replace("**", "").replace("*", ""))))).map(({ id, question }) => ({ id, question }));
  const suggestedScope = [...new Set(impacted.map((file) => `${path.posix.dirname(file)}/**`))];
  const activeScope = getOrchestrationSummary(harnessDir).activeRun?.scope ?? [];
  const outsideActiveScope = activeScope.length ? impacted.filter((file) => !activeScope.some((scope) => matchesScope(file, scope))) : [];
  return { changed, directDependents: [...direct], transitiveDependents: [...transitive], relatedTests, knowledge, openDecisions, suggestedScope, outsideActiveScope, risk: transitive.size > 0 || openDecisions.length > 0 || outsideActiveScope.length > 0 ? "high" : direct.size > 0 ? "medium" : "low", unknown };
}
