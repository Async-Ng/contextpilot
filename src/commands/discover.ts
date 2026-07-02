import * as p from "@clack/prompts";
import chalk from "chalk";
import { adoptExternalItems, pinGlobalSkill } from "../core/adopt";
import { loadConfig } from "../core/config-io";
import type { DiscoverItem } from "../core/discover";
import { scanDiscoverItems } from "../core/discover";
import {
  EXIT_OK,
  exitRequiresHuman,
  isInteractive,
  out,
  requireHarness,
} from "../core/io";
import { runSync } from "../core/sync";

export interface DiscoverOptions {
  projectOnly?: boolean;
  globalOnly?: boolean;
  dryRun?: boolean;
  internal?: boolean;
}

export async function runDiscover(
  options: DiscoverOptions = {},
): Promise<{ adoptedCount: number } | void> {
  const harnessDir = requireHarness();

  if (!options.dryRun && !isInteractive() && !options.internal) {
    exitRequiresHuman("discover");
  }

  const items = scanDiscoverItems(harnessDir, {
    projectOnly: options.projectOnly,
    globalOnly: options.globalOnly,
  });

  if (items.length === 0) {
    out("No external rules or skills found.", { items: [], plan: [] });
    if (!options.internal) process.exit(EXIT_OK);
    return { adoptedCount: 0 };
  }

  const grouped = {
    globalRules: items.filter((i) => i.level === "global" && i.kind === "rule"),
    globalSkills: items.filter((i) => i.level === "global" && i.kind === "skill"),
    projectRules: items.filter((i) => i.level === "project" && i.kind === "rule"),
    projectSkills: items.filter((i) => i.level === "project" && i.kind === "skill"),
  };

  let selected: DiscoverItem[] = items.filter((i) => i.preSelected);

  if (!options.dryRun && isInteractive() && !options.internal) {
    p.intro(chalk.bold("Discover external rules & skills"));

    const choices = await p.multiselect({
      message: "Select items to adopt into .contextpilot/",
      options: items.map((i) => ({
        value: i.path,
        label: `[${i.level}/${i.kind}] ${i.agent}: ${i.name}`,
        hint: i.path,
      })),
      initialValues: items.filter((i) => i.preSelected).map((i) => i.path),
    });

    if (p.isCancel(choices)) {
      p.cancel("Discover cancelled.");
      process.exit(EXIT_OK);
    }

    selected = items.filter((i) => (choices as string[]).includes(i.path));
  } else if (options.dryRun) {
    selected = items;
  }

  const plan = selected.map((i) => ({
    source: i.path,
    target: `.contextpilot/rules/${i.name}.md`,
    agent: i.agent,
    level: i.level,
    kind: i.kind,
  }));

  if (options.dryRun) {
    out(
      `Found ${items.length} item(s). Plan: ${plan.length} adoption(s).`,
      { items, plan, grouped },
    );
    process.exit(EXIT_OK);
    return;
  }

  if (options.internal) {
    const toAdopt = items.filter((i) => i.preSelected);
    const { adopted } = await adoptExternalItems(harnessDir, toAdopt);
    return { adoptedCount: adopted.length };
  }

  const { adopted, skillsSeen } = await adoptExternalItems(harnessDir, selected);

  const globalSkills = selected.filter(
    (i) => i.kind === "skill" && i.level === "global",
  );
  for (const skill of globalSkills) {
    const pin = await p.confirm({
      message: `Pin global skill "${skill.name}" to project skillPath?`,
      initialValue: false,
    });
    if (p.isCancel(pin)) continue;
    if (pin) {
      const config = loadConfig(harnessDir);
      await pinGlobalSkill(harnessDir, skill.path, config.srs.skillPath);
      p.log.success(`Pinned skill to ${config.srs.skillPath}`);
    }
  }

  await runSync(harnessDir);

  out(
    `Adopted ${adopted.length} rule(s), inventoried ${skillsSeen.length} skill(s).`,
    { status: "discovered", adopted, skillsSeen, plan },
  );

  p.outro(chalk.green("Discover complete."));
  process.exit(EXIT_OK);
}
