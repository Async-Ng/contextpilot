const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-sync-knowledge-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runJson(cwd, args) {
  const result = spawnSync("node", [CLI, "--json", ...args], {
    cwd,
    encoding: "utf8",
  });
  const text = result.stdout || result.stderr;
  return {
    code: result.status,
    json: text.trim() ? JSON.parse(text) : undefined,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function writeFile(cwd, relPath, content) {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function readConfig(cwd) {
  return JSON.parse(
    fs.readFileSync(path.join(cwd, ".contextpilot", "harness.config.json"), "utf8"),
  );
}

function writeConfig(cwd, config) {
  fs.writeFileSync(
    path.join(cwd, ".contextpilot", "harness.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

function seedSrs(cwd) {
  writeFile(
    cwd,
    "docs/srs/04-non-functional-requirements.md",
    "# Section 4: Non-Functional Requirements\n\nNFR-001: The system shall limit requests.\n".repeat(50),
  );
  writeFile(
    cwd,
    "docs/srs/03-functional-requirements/module-auth.md",
    "# Section 3: Functional Requirements - Module: Auth\n\nFR auth scoped body with SCOPED_AUTH_MARKER\n",
  );
  runJson(cwd, ["srs", "ingest", "--path", "docs/srs", "--reingest"]);
}

test("codex AGENTS.md uses compact knowledge and global summary, not full NFR body", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    seedSrs(cwd);

    const agentsMd = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");

    assert.match(agentsMd, /# Project Knowledge/);
    assert.match(agentsMd, /knowledge show/);
    assert.match(agentsMd, /Global SRS Summary/);
    assert.doesNotMatch(agentsMd, /NFR-001: The system shall limit requests\.\nNFR-001/);
  });
});

test("cursor _project.mdc is summary-only while scoped srs module stays full", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "cursor"]);
    seedSrs(cwd);

    const projectMdc = fs.readFileSync(
      path.join(cwd, ".cursor", "rules", "_project.mdc"),
      "utf8",
    );
    const authMdc = fs.readFileSync(
      path.join(cwd, ".cursor", "rules", "srs-03-auth.mdc"),
      "utf8",
    );

    assert.match(projectMdc, /Global SRS Summary/);
    assert.doesNotMatch(projectMdc, /NFR-001: The system shall limit requests\.\nNFR-001/);
    assert.match(authMdc, /SCOPED_AUTH_MARKER/);
    assert.ok(
      fs.existsSync(path.join(cwd, ".cursor", "rules", "_srs-global.mdc")),
    );
  });
});

test("claude CLAUDE.md follows same compact policy as codex", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "claude"]);
    seedSrs(cwd);

    const claudeMd = fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");

    assert.match(claudeMd, /Global SRS Summary/);
    assert.match(claudeMd, /knowledge show/);
    assert.doesNotMatch(claudeMd, /NFR-001: The system shall limit requests\.\nNFR-001/);
  });
});

test("inline knowledge mode regression still dumps full bodies", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    const config = readConfig(cwd);
    config.agentContext.knowledgeMode = "inline";
    writeConfig(cwd, config);
    seedSrs(cwd);

    const agentsMd = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");

    assert.match(agentsMd, /# Project Knowledge/);
    assert.match(agentsMd, /SCOPED_AUTH_MARKER/);
  });
});

test("index-only globalKnowledgePolicy links to knowledge index without summary table", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "cursor"]);
    const config = readConfig(cwd);
    config.agentContext.globalKnowledgePolicy = "index-only";
    writeConfig(cwd, config);
    seedSrs(cwd);

    const projectMdc = fs.readFileSync(
      path.join(cwd, ".cursor", "rules", "_project.mdc"),
      "utf8",
    );

    assert.match(projectMdc, /knowledge-index\.md/);
    assert.doesNotMatch(projectMdc, /Global SRS Summary/);
    assert.ok(
      fs.existsSync(path.join(cwd, ".cursor", "rules", "_srs-global.mdc")),
    );
  });
});

test("index-only globalKnowledgePolicy applies to single-file agents", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    const config = readConfig(cwd);
    config.agentContext.globalKnowledgePolicy = "index-only";
    writeConfig(cwd, config);
    seedSrs(cwd);

    const agentsMd = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");

    assert.match(agentsMd, /knowledge-index\.md/);
    assert.doesNotMatch(agentsMd, /Global SRS Summary/);
    assert.doesNotMatch(agentsMd, /NFR-001: The system shall limit requests\.\nNFR-001/);
  });
});
