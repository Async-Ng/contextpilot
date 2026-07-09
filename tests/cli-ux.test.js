const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "dist", "index.js");
const {
  resolveContextPilotCommand,
} = require(path.join(ROOT, "dist", "core", "command-resolution.js"));

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-cli-ux-"));
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

test("command resolution prefers project-local install when available", () => {
  withTempProject((cwd) => {
    const localDist = path.join(
      cwd,
      "node_modules",
      "@async-nguyen",
      "contextpilot",
      "dist",
      "index.js",
    );
    fs.mkdirSync(path.dirname(localDist), { recursive: true });
    fs.writeFileSync(localDist, "", "utf8");

    const resolved = resolveContextPilotCommand(cwd);

    assert.equal(resolved.source, "project-local");
    assert.match(resolved.command, /node ".*node_modules\/@async-nguyen\/contextpilot\/dist\/index\.js"/);
  });
});

test("command resolution falls back to dev-repo execution in this workspace", () => {
  const resolved = resolveContextPilotCommand(ROOT);

  assert.equal(resolved.source, "dev-repo");
  assert.match(resolved.command, /node ".*dist\/index\.js"/);
});

test("start reports actionable setup guidance for uninitialized projects", () => {
  withTempProject((cwd) => {
    const result = runJson(cwd, ["start"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "action_needed");
    assert.equal(result.json.initialized, false);
    assert.match(result.json.suggestedCommand, / setup$/);
    assert.equal(result.json.cliResolution.source, "dev-repo");
  });
});

test("start recommends SRS bootstrap when setup finished but greenfield SRS is missing", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    const result = runJson(cwd, ["start"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.initialized, true);
    assert.equal(result.json.status, "action_needed");
    assert.equal(result.json.srs.status, "missing");
    assert.match(result.json.suggestedCommand, /srs bootstrap --json$/);
  });
});

test("status --fast returns lightweight diagnostics and skips heavy sections", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    const result = runJson(cwd, ["status", "--fast"]);

    assert.equal(result.json.mode, "fast");
    assert.equal(result.json.diagnostics.mode, "fast");
    assert.ok(result.json.diagnostics.sections.some((s) => s.stage === "discover scan" && s.status === "skipped"));
    assert.ok(result.json.diagnostics.sections.some((s) => s.stage === "rule drift scan" && s.status === "skipped"));
    assert.equal(Array.isArray(result.json.newExternal), true);
  });
});

test("sync --preview reports unchanged files instead of rewriting them", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    const result = runJson(cwd, ["sync", "--preview"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preview");
    assert.equal(result.json.written.length, 0);
    assert.ok(result.json.unchanged.length > 0);
  });
});
