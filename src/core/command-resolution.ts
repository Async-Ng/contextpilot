import * as fs from "node:fs";
import * as path from "node:path";

type CommandSource = "project-local" | "dev-repo" | "npx-fallback";

export interface ResolvedCommand {
  command: string;
  source: CommandSource;
  packageName?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (isPlainObject(raw) && typeof raw.name === "string") {
      return raw.name;
    }
  } catch {
    // Ignore broken package.json and fall through to other resolution modes.
  }
  return undefined;
}

function quoteNodeScript(filePath: string): string {
  return `node "${filePath.replace(/\\/g, "/")}"`;
}

export function resolveContextPilotCommand(projectRoot: string): ResolvedCommand {
  const localCandidates = [
    {
      packageName: "contextpilot",
      distPath: path.join(projectRoot, "node_modules", "contextpilot", "dist", "index.js"),
    },
    {
      packageName: "@async-nguyen/contextpilot",
      distPath: path.join(
        projectRoot,
        "node_modules",
        "@async-nguyen",
        "contextpilot",
        "dist",
        "index.js",
      ),
    },
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate.distPath)) {
      return {
        command: quoteNodeScript(candidate.distPath),
        source: "project-local",
        packageName: candidate.packageName,
      };
    }
  }

  const localDist = path.resolve(__dirname, "..", "index.js");
  const localPkg = path.resolve(__dirname, "..", "..", "package.json");
  if (fs.existsSync(localDist) && fs.existsSync(localPkg)) {
    const packageName = readPackageName(localPkg);
    if (packageName === "contextpilot" || packageName === "@async-nguyen/contextpilot") {
      return {
        command: quoteNodeScript(localDist),
        source: "dev-repo",
        packageName,
      };
    }
  }

  return {
    command: "npx --no-install contextpilot",
    source: "npx-fallback",
    packageName: "@async-nguyen/contextpilot",
  };
}

export function resolvedCommandWithSubcommand(
  projectRoot: string,
  subcommand: string,
): ResolvedCommand & { invocation: string } {
  const resolved = resolveContextPilotCommand(projectRoot);
  return {
    ...resolved,
    invocation: `${resolved.command} ${subcommand}`.trim(),
  };
}
