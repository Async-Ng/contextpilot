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

function readRuns(cwd) {
  const runsFile = path.join(cwd, ".contextpilot", "orchestration", "runs.jsonl");
  return fs
    .readFileSync(runsFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test("checkpoint auto-completes the run when at the final checkpoint step", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Add refunds", "--scope", "src/**"]);
    for (const _step of ["plan", "implement", "review", "verify"]) {
      runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "done"]);
    }
    const statusBefore = runJson(cwd, ["orchestrate", "status"]);
    assert.equal(statusBefore.json.orchestration.activeStep.id, "checkpoint");

    const result = runJson(cwd, ["checkpoint"]);

    assert.equal(result.code, 0);
    assert.match(result.json.orchestrationNote, /completed automatically/);
    assert.equal(result.json.orchestration.activeRun, undefined);

    const statusAfter = runJson(cwd, ["orchestrate", "status"]);
    assert.equal(statusAfter.json.orchestration.activeRun, undefined);

    const runs = readRuns(cwd);
    const lastRun = runs.at(-1);
    assert.equal(lastRun.status, "completed");
    assert.equal(
      lastRun.steps.find((s) => s.id === "checkpoint").status,
      "completed",
    );
  });
});

test("checkpoint warns instead of advancing when the run isn't at its checkpoint step", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Add refunds", "--scope", "src/**"]);

    const result = runJson(cwd, ["checkpoint"]);

    assert.equal(result.code, 0);
    assert.match(result.json.orchestrationNote, /not yet its final checkpoint step/);
    assert.equal(result.json.orchestration.activeRun.status, "active");
    assert.equal(result.json.orchestration.activeStep.id, "plan");

    const runs = readRuns(cwd);
    const lastRun = runs.at(-1);
    assert.equal(lastRun.status, "active");
    assert.equal(lastRun.activeStepId, "plan");
  });
});

test("strict SRS bootstrap mode blocks business edits while allowing docs/srs", () => {
  withProject((cwd) => {
    const config = readConfig(cwd);
    config.srs.bootstrapMode = "strict";
    writeConfig(cwd, config);

    const srcResult = spawnSync(
      "node",
      [CLI, "gate", "check", "--agent", "claude"],
      {
        cwd,
        input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
        encoding: "utf8",
      },
    );
    const srsResult = spawnSync(
      "node",
      [CLI, "gate", "check", "--agent", "claude"],
      {
        cwd,
        input: JSON.stringify({ tool_input: { file_path: "docs/srs/README.md" } }),
        encoding: "utf8",
      },
    );

    assert.equal(srcResult.status, 2);
    assert.match(srcResult.stderr, /contextpilot srs bootstrap --json/);
    assert.equal(srsResult.status, 0);
  });
});
