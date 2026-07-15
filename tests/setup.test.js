const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-setup-"));
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

function readState(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".contextpilot", "state.json"), "utf8"));
}

function writeFile(cwd, relPath, content) {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

test("setup on a fresh project creates harness storage and generated protocol", () => {
  withTempProject((cwd) => {
    const result = runJson(cwd, ["setup", "--no-git"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "setup");
    assert.equal(result.json.mode, "fresh");
    assert.equal(result.json.message, "Setup complete. Now chat with your AI agent normally.");
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "harness.config.json")));
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "orchestration", "runs.jsonl")));
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "orchestration", "events.jsonl")));
    assert.equal(readState(cwd).srs.status, "missing");
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, ".contextpilot", "harness.config.json"), "utf8"),
    );
    assert.equal(config.profile, "light");
    assert.equal(config.agentContext.protocolLevel, "stub");
    assert.equal(config.agentContext.globalKnowledgePolicy, "index-only");
    assert.equal(config.hooks.infrastructureFailure, "warn-open");

    const agentsMd = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /lightweight default/);
    assert.match(agentsMd, /small technical tasks/);
    assert.doesNotMatch(agentsMd, /User Interaction Rule/);
    assert.match(agentsMd, /SRS Bootstrap Required/);
  });
});

test("setup ingests existing docs/srs and marks SRS ingested", () => {
  withTempProject((cwd) => {
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nExisting auth requirements\n",
    );

    const result = runJson(cwd, ["setup", "--no-git"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.srs.knowledgeUpserted, 1);
    assert.equal(readState(cwd).srs.status, "ingested");
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "rules", "srs-03-auth.md")));
  });
});

test("setup on an existing harness preserves memory and orchestration history", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    runJson(cwd, [
      "learn",
      "--category",
      "constraint",
      "--severity",
      "med",
      "--title",
      "Preserve me",
      "--detail",
      "Do not delete existing memory",
    ]);
    runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Preserve run",
      "--scope",
      "src/**",
    ]);

    const memoryBefore = fs.readFileSync(
      path.join(cwd, ".contextpilot", "memory", "learnings.jsonl"),
      "utf8",
    );
    const runsBefore = fs.readFileSync(
      path.join(cwd, ".contextpilot", "orchestration", "runs.jsonl"),
      "utf8",
    );

    const result = runJson(cwd, ["setup", "--no-git"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.mode, "existing");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".contextpilot", "memory", "learnings.jsonl"), "utf8"),
      memoryBefore,
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, ".contextpilot", "orchestration", "runs.jsonl"), "utf8"),
      runsBefore,
    );
  });
});

test("setup migrates legacy .harness storage to .contextpilot without data loss", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    runJson(cwd, [
      "learn",
      "--category",
      "constraint",
      "--severity",
      "med",
      "--title",
      "Migrate me",
      "--detail",
      "Do not delete legacy memory",
    ]);
    runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Migrate run",
      "--scope",
      "src/**",
    ]);

    const currentDir = path.join(cwd, ".contextpilot");
    const legacyDir = path.join(cwd, ".harness");
    const memoryBefore = fs.readFileSync(
      path.join(currentDir, "memory", "learnings.jsonl"),
      "utf8",
    );
    const runsBefore = fs.readFileSync(
      path.join(currentDir, "orchestration", "runs.jsonl"),
      "utf8",
    );

    fs.renameSync(currentDir, legacyDir);
    const legacyConfigPath = path.join(legacyDir, "harness.config.json");
    fs.writeFileSync(
      legacyConfigPath,
      fs.readFileSync(legacyConfigPath, "utf8").replaceAll(".contextpilot", ".harness"),
      "utf8",
    );

    const result = runJson(cwd, ["setup", "--no-git"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.mode, "existing");
    assert.equal(result.json.migratedFrom, legacyDir);
    assert.ok(fs.existsSync(currentDir));
    assert.ok(!fs.existsSync(legacyDir));
    assert.equal(
      fs.readFileSync(path.join(currentDir, "memory", "learnings.jsonl"), "utf8"),
      memoryBefore,
    );
    assert.equal(
      fs.readFileSync(path.join(currentDir, "orchestration", "runs.jsonl"), "utf8"),
      runsBefore,
    );

    const config = JSON.parse(
      fs.readFileSync(path.join(currentDir, "harness.config.json"), "utf8"),
    );
    assert.equal(config.memoryFile, ".contextpilot/memory/learnings.jsonl");
    assert.equal(config.gate.decisionsFile, ".contextpilot/decisions/decisions.jsonl");
  });
});

test("context inject includes user-invisible automation guidance", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    const result = runJson(cwd, ["context", "--inject"]);

    assert.equal(result.code, 0);
    assert.match(result.json.text, /Agent Automation Contract/);
    assert.match(result.json.text, /The user should chat normally/);
  });
});
