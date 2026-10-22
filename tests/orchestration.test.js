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
    json: text.trim() ? (text.trimStart().startsWith('{"type":"start"')
      ? JSON.parse(text.trim().split("\n").at(-1)).result
      : JSON.parse(text)) : undefined,
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
        "  - src/refunds/**",
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
      "src/refunds/**",
    ]);
    const result = runJson(cwd, ["context", "--inject"]);

    assert.equal(result.code, 0);
    assert.ok(result.json.suggestedKnowledge.length > 0);
    assert.equal(result.json.suggestedKnowledge[0].id, "srs-03-refunds");
    assert.match(result.json.text, /Suggested Knowledge/);
    assert.match(result.json.suggestedKnowledge[0].hint, /knowledge show/);
  });
});

test("context inject omits weak cross-module suggestions", () => {
  withProject((cwd) => {
    const rulesDir = path.join(cwd, ".contextpilot", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    for (const module of ["transfer", "ai-incident-insight"]) {
      fs.writeFileSync(path.join(rulesDir, `srs-07-${module}.md`), [
        "---", `id: srs-07-${module}`, `title: SRS 07 ${module}`,
        "type: knowledge", "priority: high", 'section: "07"',
        `module: ${module}`, "scope:", "  - src/**", "targets:", "  - claude", "---", "", "Unrelated rules",
      ].join("\n"));
    }
    runJson(cwd, ["orchestrate", "start", "--goal", "Subjects UX", "--scope", "src/subjects/**"]);
    const result = runJson(cwd, ["context", "--inject"]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.suggestedKnowledge, []);
  });
});

test("Claude session context does not repeat learnings from CLAUDE.md", () => {
  withProject((cwd) => {
    const learned = runJson(cwd, ["learn", "--category", "constraint", "--severity", "high", "--title", "Unique learning", "--detail", "Keep this once", "--scope", "src/**"]);
    assert.equal(learned.code, 0);
    runJson(cwd, ["sync"]);
    assert.match(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), /Unique learning/);
    const result = runJson(cwd, ["context", "--inject", "--agent", "claude"]);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.json.text, /Top Learnings|Unique learning/);
    assert.equal(result.json.learnings.length, 1);
  });
});

test("inactive run prompts evidence review without requiring an advance", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Old lab exercises", "--scope", "src/lab-exercises/**", "--preset", "lightweight"]);
    const eventsPath = path.join(cwd, ".contextpilot", "orchestration", "events.jsonl");
    const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => ({ ...JSON.parse(line), createdAt: "2024-01-01T00:00:00.000Z" }));
    fs.writeFileSync(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const result = runJson(cwd, ["context", "--inject"]);
    assert.equal(result.code, 0);
    assert.match(result.json.text, /Check the goal and scope against recent commits and test evidence/);
    assert.doesNotMatch(result.json.text, /Next required command|When this step is done, run/);
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

test("Claude gate allows malformed hook JSON with a warning", () => {
  withProject((cwd) => {
    const result = spawnSync("node", [CLI, "gate", "check", "--agent", "claude"], {
      cwd,
      input: "{invalid",
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /invalid Claude hook JSON; allowing action/);
  });
});

test("Claude plan files bypass project scope while other external files stay denied", () => {
  withProject((cwd) => {
    runJson(cwd, ["orchestrate", "start", "--goal", "Update subjects", "--scope", "src/subjects/**"]);
    const plansDir = path.join(os.homedir(), ".claude", "plans");
    const check = (file) => spawnSync("node", [CLI, "gate", "check", "--agent", "claude"], {
      cwd,
      input: JSON.stringify({ tool_input: { file_path: file } }),
      encoding: "utf8",
    });

    const plan = path.join(plansDir, "updated-subjects.md");
    assert.equal(check(plan).status, 0);
    assert.equal(runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan reviewed"]).code, 0);
    assert.equal(check(plan).status, 0);

    for (const file of [
      path.join(plansDir, "..", "other.md"),
      path.join(os.homedir(), ".claude", "plans-extra", "other.md"),
      path.join(plansDir, "other.txt"),
      path.join(cwd, "..", "other.md"),
    ]) {
      const denied = check(file);
      assert.equal(denied.status, 2, file);
      assert.match(denied.stderr, /outside the project/);
      assert.doesNotMatch(denied.stderr, /orchestrate scope add/);
    }
    const scoped = check(path.join(cwd, "src", "other.ts"));
    assert.equal(scoped.status, 2);
    assert.match(scoped.stderr, /outside active orchestration scope/);
    assert.equal(check("src/subjects/../other.ts").status, 2);

    const { evaluate } = require("../dist/core/gate");
    assert.equal(evaluate(path.join(cwd, ".contextpilot"), { file: plan, agent: "cursor" }).decision, "deny");
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

test("precommit enforces active run scope and accepts an audited expansion", () => {
  withProject((cwd) => {
    execFileSync("git", ["init", "-q"], { cwd });
    fs.mkdirSync(path.join(cwd, "api", "src", "schedules"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "api", "src", "schedules", "swap.ts"), "export {};\n");
    execFileSync("git", ["add", "api/src/schedules/swap.ts"], { cwd });
    runJson(cwd, ["orchestrate", "start", "--goal", "Schedule swap", "--scope", "docs/srs/**"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);
    const denied = spawnSync("node", [CLI, "gate", "precommit"], { cwd, encoding: "utf8" });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /outside active orchestration scope/);
    runJson(cwd, ["orchestrate", "scope", "add", "--scope", "api/src/schedules/**", "--reason", "Implementation requires API changes"]);
    const allowed = spawnSync("node", [CLI, "gate", "precommit"], { cwd, encoding: "utf8" });
    assert.equal(allowed.status, 0);
  });
});

test("precommit removes staged runtime files and commits the product file", () => {
  withProject((cwd) => {
    execFileSync("git", ["init", "-q"], { cwd });
    const log = ".contextpilot/logs/sync with space.jsonl";
    const runtime = ".contextpilot/runtime/state.json";
    const product = "api/src/subjects/subject.ts";
    for (const file of [log, runtime, product]) {
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), "{}\n");
    }
    execFileSync("git", ["add", "-f", log, runtime, product], { cwd });
    runJson(cwd, ["orchestrate", "start", "--goal", "Edit subjects", "--scope", "api/src/subjects/**"]);
    runJson(cwd, ["orchestrate", "advance", "--status", "complete", "--note", "plan"]);
    const result = spawnSync("node", [CLI, "gate", "precommit"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /removed runtime artifact/);
    assert.equal(fs.existsSync(path.join(cwd, log)), true);
    assert.equal(fs.existsSync(path.join(cwd, runtime)), true);
    assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" }).trim(), product);
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "product"], { cwd });
    assert.equal(execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], { cwd, encoding: "utf8" }).trim(), product);
  });
});

test("precommit stops tracking an existing runtime log without deleting it", () => {
  withProject((cwd) => {
    execFileSync("git", ["init", "-q"], { cwd });
    const log = ".contextpilot/logs/sync-123.jsonl";
    fs.mkdirSync(path.join(cwd, ".contextpilot", "logs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, log), "{}\n");
    execFileSync("git", ["add", "-f", log], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "old log"], { cwd });
    assert.equal(execFileSync("git", ["ls-files", "--", log], { cwd, encoding: "utf8" }).trim(), log);
    fs.writeFileSync(path.join(cwd, log), '{"new":true}\n');
    execFileSync("git", ["add", "-f", log], { cwd });
    const result = spawnSync("node", [CLI, "gate", "precommit"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(cwd, log)), true);
    assert.equal(execFileSync("git", ["diff", "--cached", "--name-status"], { cwd, encoding: "utf8" }).trim(), `D\t${log}`);
  });
});

test("precommit blocks when Git cannot remove a runtime file from the index", () => {
  withProject((cwd) => {
    execFileSync("git", ["init", "-q"], { cwd });
    const log = ".contextpilot/logs/sync-123.jsonl";
    fs.mkdirSync(path.join(cwd, ".contextpilot", "logs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, log), "{}\n");
    execFileSync("git", ["add", "-f", log], { cwd });
    const lock = path.join(cwd, ".git", "index.lock");
    fs.writeFileSync(lock, "");
    try {
      const result = spawnSync("node", [CLI, "gate", "precommit"], { cwd, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /could not remove runtime artifact/);
      assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" }).trim(), log);
      assert.equal(fs.existsSync(path.join(cwd, log)), true);
    } finally {
      fs.rmSync(lock, { force: true });
    }
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
