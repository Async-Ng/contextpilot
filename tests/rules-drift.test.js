const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-rules-"));
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

function runRaw(cwd, args) {
  return spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function writeFile(cwd, relPath, content) {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

test("srs ingest warns and status reports drift when a rule file was hand-edited", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nOriginal auth body\n",
    );
    runJson(cwd, ["srs", "ingest", "--path", "docs/srs"]);

    const clean = runJson(cwd, ["status"]);
    assert.deepEqual(clean.json.ruleDrift, []);

    const rulePath = path.join(cwd, ".contextpilot", "rules", "srs-03-auth.md");
    fs.appendFileSync(rulePath, "\nHand-edited addition\n", "utf8");

    const dirty = runJson(cwd, ["status"]);
    assert.equal(dirty.json.ruleDrift.length, 1);
    assert.equal(dirty.json.ruleDrift[0].path, ".contextpilot/rules/srs-03-auth.md");
    assert.equal(dirty.json.ruleDrift[0].kind, "stale");

    const reingest = runRaw(cwd, ["srs", "ingest", "--path", "docs/srs", "--reingest"]);
    assert.equal(reingest.status, 0);
    assert.match(reingest.stderr, /Overwriting hand-edited rule file/);
    assert.match(reingest.stderr, /srs-03-auth\.md/);

    const afterReingest = runJson(cwd, ["status"]);
    assert.deepEqual(afterReingest.json.ruleDrift, []);
  });
});

test("rule files written outside the SRS ingest path are not flagged as drift", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(cwd, "src/billing/index.ts", "export const x = 1;\n");

    const opened = runJson(cwd, [
      "decision",
      "open",
      "--question",
      "How should billing work?",
      "--scope",
      "src/billing/**",
    ]);
    assert.equal(opened.code, 0);

    const resolved = runJson(cwd, [
      "decision",
      "resolve",
      opened.json.id,
      "--resolution",
      "Use flat-rate billing.",
    ]);
    assert.equal(resolved.code, 0);

    const status = runJson(cwd, ["status"]);
    assert.deepEqual(status.json.ruleDrift, []);
  });
});

test("status flags a decision scope that matches no files", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);

    const opened = runJson(cwd, [
      "decision",
      "open",
      "--question",
      "Should we do X?",
      "--scope",
      "src/nonexistent-module/**",
    ]);
    assert.equal(opened.code, 0);

    const status = runJson(cwd, ["status"]);
    const match = status.json.staleDecisionScopes.find((s) => s.id === opened.json.id);
    assert.ok(match, "expected staleDecisionScopes to include the opened decision");
    assert.equal(match.scope, "src/nonexistent-module/**");
  });
});

test("status does not flag a decision scope that matches real files", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(cwd, "src/real-module/index.ts", "export const x = 1;\n");

    const opened = runJson(cwd, [
      "decision",
      "open",
      "--question",
      "Should we do Y?",
      "--scope",
      "src/real-module/**",
    ]);
    assert.equal(opened.code, 0);

    const status = runJson(cwd, ["status"]);
    const match = status.json.staleDecisionScopes.find((s) => s.id === opened.json.id);
    assert.equal(match, undefined);
  });
});

test("a module documented with the Module Removed heading is tagged removed and excluded from staleRuleScopes", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-academic-terms.md",
      [
        "# Section 3: Functional Requirements - Module: Academic Terms",
        "",
        "## Module Removed",
        "",
        "This module was removed entirely; superseded by plain fields on Schedule.",
        "",
      ].join("\n"),
    );

    const ingest = runJson(cwd, ["srs", "ingest", "--path", "docs/srs"]);
    assert.equal(ingest.code, 0);

    const rulePath = path.join(cwd, ".contextpilot", "rules", "srs-03-academic-terms.md");
    const ruleContent = fs.readFileSync(rulePath, "utf8");
    assert.match(ruleContent, /priority: low/);
    assert.match(ruleContent, /tags:\s*\n\s*-\s*removed/);

    const status = runJson(cwd, ["status"]);
    const match = status.json.staleRuleScopes.find((s) => s.id === "srs-03-academic-terms");
    assert.equal(match, undefined, "removed-tagged rule's dead scope should not be flagged");
  });
});

test("a non-removed module with a scope matching no files is flagged in staleRuleScopes", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-ghost.md",
      "# Section 3: Functional Requirements - Module: Ghost\n\nStill an active module, just no matching code yet.\n",
    );

    const ingest = runJson(cwd, ["srs", "ingest", "--path", "docs/srs"]);
    assert.equal(ingest.code, 0);

    const status = runJson(cwd, ["status"]);
    const match = status.json.staleRuleScopes.find((s) => s.id === "srs-03-ghost");
    assert.ok(match, "expected staleRuleScopes to flag the non-removed module's dead scope");
    assert.equal(match.scope, "**/ghost*");
  });
});
