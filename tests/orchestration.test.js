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

test("orchestrate start supports lightweight preset", () => {
  withProject((cwd) => {
    const result = runJson(cwd, [
      "orchestrate",
      "start",
      "--goal",
      "Fix button spacing",
      "--scope",
      "src/**",
      "--preset",
      "lightweight",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.run.preset, "lightweight");
    assert.equal(result.json.run.activeStepId, "implement");
    assert.deepEqual(
      result.json.run.steps.map((s) => s.id),
      ["implement", "verify", "checkpoint"],
    );
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

test("context inject suggests knowledge for orchestration scope", () => {
  withProject((cwd) => {
    const rulesDir = path.join(cwd, ".contextpilot", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "srs-03-refunds.md"),
      [
        "---",
        "id: srs-03-refunds",
        'title: "SRS 03: Refunds"',
        "type: knowledge",
        "priority: high",
        "section: \"03\"",
        "module: refunds",
        "scope:",
        "  - src/**",
        "targets:",
        "  - claude",
        "  - cursor",
        "  - codex",
        "---",
        "",
        "Refund requirements for orchestration scope matching.",
      ].join("\n"),
      "utf8",
    );

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
    assert.ok(result.json.suggestedKnowledge.length > 0);
    assert.equal(result.json.suggestedKnowledge[0].id, "srs-03-refunds");
    assert.match(result.json.text, /Suggested Knowledge/);
    assert.match(result.json.suggestedKnowledge[0].hint, /knowledge show/);
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

test("gate denial suggests reopen during review", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Add refunds", "--scope", "src/**"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "impl"]);

    const result = spawnSync("node", [CLI, "gate", "check", "--agent", "claude"], {
      cwd,
      input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /orchestrate reopen --step implement/);
  });
});

test("orchestrate reopen returns to implement with audit trail", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Add refunds", "--scope", "src/**"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "impl"]);

    const result = runJson(cwd, [
      "orchestrate",
      "reopen",
      "--step",
      "implement",
      "--reason",
      "Review found missing edge case",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "reopened");
    assert.equal(result.json.run.activeStepId, "implement");
    assert.equal(result.json.run.steps.find((s) => s.id === "review").status, "pending");

    const events = fs
      .readFileSync(path.join(cwd, ".contextpilot", "orchestration", "events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, "step_reopened");
  });
});

test("orchestrate scope add expands scope and out-of-scope denial suggests command", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Update CI", "--scope", "src/**"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);

    const denied = spawnSync("node", [CLI, "gate", "check", "--agent", "claude"], {
      cwd,
      input: JSON.stringify({ tool_input: { file_path: ".github/workflows/test.yml" } }),
      encoding: "utf8",
    });
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /orchestrate scope add/);

    const result = runJson(cwd, [
      "orchestrate",
      "scope",
      "add",
      "--scope",
      ".github/**",
      "--reason",
      "CI config needed",
    ]);

    assert.equal(result.code, 0);
    assert.deepEqual(result.json.addedScope, [".github/**"]);
    assert.deepEqual(result.json.nextScope, ["src/**", ".github/**"]);
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

test("checkpoint no-persist does not append orchestration events", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Add refunds", "--scope", "src/**"]);
    const eventsPath = path.join(cwd, ".contextpilot", "orchestration", "events.jsonl");
    const before = fs.readFileSync(eventsPath, "utf8");

    const result = runJson(cwd, ["checkpoint", "--no-persist"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.noPersist, true);
    assert.equal(fs.readFileSync(eventsPath, "utf8"), before);
  });
});

test("runtime project mode stores orchestration outside tracked state files", () => {
  withProject((cwd) => {
    const config = readConfig(cwd);
    config.runtime = { mode: "project" };
    writeConfig(cwd, config);

    const result = runJson(cwd, ["orchestrate", "start", "--goal", "Runtime run", "--scope", "src/**"]);

    assert.equal(result.code, 0);
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "runtime", "state.json")));
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "runtime", "orchestration", "runs.jsonl")));
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".contextpilot", "state.json"), "utf8"));
    assert.equal(state.orchestration.activeRunId, undefined);
  });
});

test("contract verification records bounded evidence and transitions to review", () => {
  withProject((cwd) => {
    const contract = path.join(cwd, "contract.json");
    fs.writeFileSync(contract, JSON.stringify({
      acceptanceCriteria: ["Tests pass"],
      verificationCommands: ["node --version"],
      riskLevel: "medium",
      packs: ["test-repair"],
    }), "utf8");
    const started = runJson(cwd, ["orchestrate", "start", "--goal", "Verify", "--scope", "src/**", "--contract", "contract.json"]);
    assert.equal(started.json.run.contract.riskLevel, "medium");
    assert.ok(started.json.run.worktree.worktreePath);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "implementation"]);
    const result = runJson(cwd, ["orchestrate", "verify"]);
    assert.equal(result.code, 0);
    assert.equal(result.json.run.activeStepId, "review");
    assert.equal(result.json.run.evidence.length, 1);
    assert.equal(result.json.run.evidence[0].exitCode, 0);
    assert.ok(result.json.run.evidence[0].outputPreview.length > 0);
  });
});

test("revision conflict prevents stale orchestration mutation", () => {
  withProject((cwd) => {
    const started = runJson(cwd, ["orchestrate", "start", "--goal", "Revision", "--scope", "src/**"]);
    const result = runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--expected-revision", String(started.json.run.revision + 1)]);
    assert.equal(result.code, 1);
    assert.match(result.json.message, /revision conflict/);
  });
});

test("failed review transitions back to implement for a fix loop", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Review loop", "--scope", "src/**"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "implement"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "verify"]);
    const result = runJson(cwd, ["orchestrate", "advance", "--status", "failed", "--note", "review found a bug"]);
    assert.equal(result.code, 0);
    assert.equal(result.json.run.activeStepId, "implement");
    assert.equal(result.json.run.status, "active");
  });
});

test("context explain, run report, trace export, and eval expose local harness artifacts", () => {
  withProject((cwd) => {
    const started = runJson(cwd, ["orchestrate", "start", "--goal", "Artifacts", "--scope", "src/**"]);
    const explain = runJson(cwd, ["context", "explain"]);
    assert.equal(explain.code, 0);
    assert.ok(explain.json.contextManifest.some((item) => item.source === "run-contract"));
    const report = runJson(cwd, ["run", "report", "--run", started.json.run.id]);
    assert.equal(report.code, 0);
    assert.equal(report.json.runId, started.json.run.id);
    const trace = runJson(cwd, ["trace", "export", "--format", "otlp-json", "--run", started.json.run.id]);
    assert.equal(trace.code, 0);
    assert.equal(trace.json.resourceSpans[0].resource.attributes["service.name"], "contextpilot");
    const evaluation = runJson(cwd, ["eval", "run"]);
    assert.equal(evaluation.code, 0);
    assert.equal(evaluation.json.passed, true);
  });
});

test("risky command requires a time-bound approval tied to the run", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Risk", "--scope", "src/**"]);
    const denied = spawnSync("node", [CLI, "gate", "check", "--agent", "cursor"], {
      cwd,
      input: JSON.stringify({ command: "curl https://example.test" }),
      encoding: "utf8",
    });
    assert.equal(denied.status, 2);
    const response = JSON.parse(denied.stdout);
    const requestId = response.agentMessage.match(/--request (approval_[a-zA-Z0-9_-]+)/)[1];
    const granted = runJson(cwd, ["approval", "grant", "--request", requestId, "--reason", "approved"]);
    assert.equal(granted.code, 0);
    const allowed = spawnSync("node", [CLI, "gate", "check", "--agent", "cursor"], {
      cwd,
      input: JSON.stringify({ command: "curl https://example.test" }),
      encoding: "utf8",
    });
    assert.equal(allowed.status, 0);
    assert.equal(JSON.parse(allowed.stdout).permission, "allow");
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
