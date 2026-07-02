const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-test-"));
  try {
    execFileSync("node", [CLI, "--json", "init", "--yes", "--no-input"], {
      cwd: dir,
      stdio: "pipe",
    });
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runJson(cwd, args, input) {
  const result = spawnSync("node", [CLI, "--json", ...args], {
    cwd,
    input,
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

test("orchestrate start creates a coding run and active plan step", () => {
  withProject((cwd) => {
    const result = runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Add refunds",
      "--scope",
      "src/**",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "started");
    assert.equal(result.json.run.goal, "Add refunds");
    assert.deepEqual(result.json.run.scope, ["src/**"]);
    assert.equal(result.json.run.activeStepId, "plan");
    assert.equal(result.json.activeStep.role, "planner");
  });
});

test("orchestrate start reports missing goal with missing_flag", () => {
  withProject((cwd) => {
    const result = runJson(cwd, ["orchestrate", "start", "--scope", "src/**"]);

    assert.equal(result.code, 2);
    assert.equal(result.json.error, "missing_flag");
    assert.equal(result.json.flag, "--goal");
  });
});

test("advance completes current step and activates the next step", () => {
  withProject((cwd) => {
    runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Add refunds",
      "--scope",
      "src/**",
    ]);
    const result = runJson(cwd, [
      "orchestrate",
      "advance",
      "--status",
      "complete",
      "--note",
      "Plan done",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.run.activeStepId, "implement");
    assert.equal(result.json.activeStep.role, "implementer");
    assert.equal(result.json.run.steps[0].status, "completed");
  });
});

test("context inject includes active orchestration details", () => {
  withProject((cwd) => {
    runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Add refunds",
      "--scope",
      "src/**",
    ]);
    const result = runJson(cwd, ["context", "--inject"]);

    assert.equal(result.code, 0);
    assert.match(result.json.text, /Active Orchestration/);
    assert.match(result.json.text, /Role: planner/);
    assert.equal(result.json.orchestration.activeStep.role, "planner");
  });
});

test("gate denies file edits during non-edit orchestration step", () => {
  withProject((cwd) => {
    runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Add refunds",
      "--scope",
      "src/**",
    ]);
    const result = spawnSync(
      "node",
      [CLI, "gate", "check", "--agent", "claude"],
      {
        cwd,
        input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not allow file edits/);
  });
});
