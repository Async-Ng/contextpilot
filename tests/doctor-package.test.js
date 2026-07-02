const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "dist", "index.js");

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-doctor-test-"));
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
  };
}

test("package metadata is public and binary is contextpilot", () => {
  const pkg = require(path.join(ROOT, "package.json"));

  assert.equal(pkg.name, "@async-nguyen/contextpilot");
  assert.equal(pkg.version, "0.3.0");
  assert.equal(pkg.bin["contextpilot"], "dist/index.js");
  assert.equal(pkg.publishConfig.access, "public");
  assert.ok(pkg.engines.node);
  assert.ok(fs.existsSync(path.join(ROOT, "LICENSE")));
  assert.ok(fs.existsSync(path.join(ROOT, "CHANGELOG.md")));
});

test("doctor reports uninitialized projects without failing", () => {
  withTempProject((cwd) => {
    const result = runJson(cwd, ["doctor"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.initialized, false);
    assert.equal(result.json.status, "warn");
    assert.ok(result.json.checks.some((c) => c.name === "initialized" && c.status === "warn"));
  });
});

test("doctor reports initialized projects and generated files", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    const result = runJson(cwd, ["doctor"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.initialized, true);
    assert.ok(result.json.checks.some((c) => c.name === "generated codex" && c.status === "pass"));
    assert.ok(result.json.checks.some((c) => c.name === "package assets" && c.status === "pass"));
  });
});
