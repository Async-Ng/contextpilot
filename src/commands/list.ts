import chalk from "chalk";
import { listRules } from "../core/rules";
import { readActiveLearnings } from "../core/memory";
import { EXIT_OK, out, requireHarness } from "../core/io";

export interface ListOptions {
  rules?: boolean;
  learnings?: boolean;
}

export function runList(options: ListOptions): void {
  const harnessDir = requireHarness();
  const showBoth = options.rules === undefined && options.learnings === undefined;
  const includeRules = showBoth || options.rules === true;
  const includeLearnings = showBoth || options.learnings === true;

  const result: {
    rules?: Array<{
      id: string;
      title: string;
      type: string;
      targets: string[];
      priority: string;
      tags: string[];
    }>;
    learnings?: Array<{
      id: string;
      severity: string;
      category: string;
      title: string;
      pinned: boolean;
      tags: string[];
      status: string;
    }>;
  } = {};

  if (includeRules) {
    result.rules = listRules(harnessDir).map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      targets: r.targets,
      priority: r.priority,
      tags: r.tags,
    }));
  }

  if (includeLearnings) {
    result.learnings = readActiveLearnings(harnessDir).map((l) => ({
      id: l.id,
      severity: l.severity,
      category: l.category,
      title: l.title,
      pinned: l.pinned,
      tags: l.tags,
      status: l.status,
    }));
  }

  const humanParts: string[] = [];
  if (result.rules) {
    humanParts.push(chalk.bold("Rules:"));
    for (const r of result.rules) {
      humanParts.push(`  ${r.id} [${r.type}/${r.priority}] ${r.title}`);
    }
  }
  if (result.learnings) {
    humanParts.push(chalk.bold("Learnings:"));
    for (const l of result.learnings) {
      humanParts.push(`  ${l.id} [${l.severity}] ${l.title}`);
    }
  }

  out(humanParts.join("\n"), result);
  process.exit(EXIT_OK);
}
