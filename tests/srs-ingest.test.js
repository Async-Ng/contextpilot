const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-srs-"));
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

function readRule(cwd, id) {
  return fs.readFileSync(path.join(cwd, ".contextpilot", "rules", `${id}.md`), "utf8");
}

function readConfig(cwd) {
  return JSON.parse(
    fs.readFileSync(path.join(cwd, ".contextpilot", "harness.config.json"), "utf8"),
  );
}

function readState(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".contextpilot", "state.json"), "utf8"));
}

function writeConfig(cwd, config) {
  fs.writeFileSync(
    path.join(cwd, ".contextpilot", "harness.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

test("srs ingest reads nested module files and ignores section README indexes", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/README.md",
      "# Section 3 Index\n\n[module-auth.md](module-auth.md)\n",
    );
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nFR auth body\n",
    );
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-billing.md",
      "# Section 3: Functional Requirements - Module: Billing\n\nFR billing body\n",
    );
    writeFile(
      cwd,
      "docs/srs/06-data-requirements/module-auth.md",
      "# Section 6: Data Requirements - Module: Auth\n\nData auth body\n",
    );
    writeFile(
      cwd,
      "docs/srs/07-business-rules/module-auth.md",
      "# Section 7: Business Rules - Module: Auth\n\nBR auth body\n",
    );
    writeFile(
      cwd,
      "docs/srs/08-use-cases-user-stories/module-auth.md",
      "# Section 8: Use Cases / User Stories - Module: Auth\n\nUC auth body\n",
    );

    const result = runJson(cwd, ["srs", "ingest"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.knowledgeUpserted, 5);
    assert.match(readRule(cwd, "srs-03-auth"), /FR auth body/);
    assert.match(readRule(cwd, "srs-03-billing"), /FR billing body/);
    assert.match(readRule(cwd, "srs-06-auth"), /Data auth body/);
    assert.match(readRule(cwd, "srs-07-auth"), /BR auth body/);
    assert.match(readRule(cwd, "srs-08-auth"), /UC auth body/);
    const authRule = readRule(cwd, "srs-07-auth");
    assert.match(authRule, /section: "?07"?/);
    assert.match(authRule, /module: auth/);
    assert.match(authRule, /canonicalSource: docs\/srs\/07-business-rules\/module-auth\.md/);
    assert.match(authRule, /srsKind: business-rules/);
    assert.equal(
      fs.existsSync(path.join(cwd, ".contextpilot", "rules", "srs-03-section-3-index.md")),
      false,
    );
  });
});

test("srs install creates shared skill and Claude compatibility copy", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "claude"]);

    const result = runJson(cwd, ["srs", "install"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "installed");
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "skills", "fullstack-to-srs", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "fullstack-to-srs", "SKILL.md")));
    assert.match(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), /\.contextpilot\/skills\/fullstack-to-srs\/SKILL\.md/);
  });
});

test("srs bootstrap creates skeleton, skill, focus, orchestration, and syncs", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);

    const result = runJson(cwd, ["srs", "bootstrap"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "bootstrapped");
    assert.equal(result.json.srs.status, "bootstrapped");
    assert.equal(result.json.orchestration.status, "started");
    assert.equal(result.json.orchestration.run.goal, "Create initial SRS");
    assert.deepEqual(result.json.orchestration.run.scope, ["docs/srs/**"]);
    assert.ok(fs.existsSync(path.join(cwd, "docs", "srs", "README.md")));
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "skills", "fullstack-to-srs", "SKILL.md")));
    assert.match(
      fs.readFileSync(path.join(cwd, ".contextpilot", "context", "current.md"), "utf8"),
      /Build initial SRS/,
    );
    assert.match(fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8"), /SRS Bootstrap Required/);
    assert.equal(readState(cwd).srs.status, "bootstrapped");
  });
});

test("srs bootstrap is idempotent and does not overwrite existing SRS README", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(cwd, "docs/srs/README.md", "# Custom SRS\n\nKeep this.\n");

    const first = runJson(cwd, ["srs", "bootstrap"]);
    const second = runJson(cwd, ["srs", "bootstrap"]);

    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    assert.equal(second.json.readme.created, false);
    assert.equal(second.json.orchestration.status, "already_active");
    assert.equal(fs.readFileSync(path.join(cwd, "docs", "srs", "README.md"), "utf8"), "# Custom SRS\n\nKeep this.\n");
  });
});

test("srs status reports bootstrap state and ingest transitions to ingested", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    runJson(cwd, ["srs", "bootstrap"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nBootstrapped auth requirements\n",
    );

    const statusBefore = runJson(cwd, ["srs", "status"]);
    const ingest = runJson(cwd, ["srs", "ingest", "--path", "docs/srs", "--reingest"]);
    const statusAfter = runJson(cwd, ["srs", "status"]);

    assert.equal(statusBefore.json.srs.status, "bootstrapped");
    assert.equal(ingest.code, 0);
    assert.equal(readState(cwd).srs.status, "ingested");
    assert.equal(statusAfter.json.srs.status, "ingested");
  });
});

test("srs install supports non-Claude agents through shared skill path", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);

    const result = runJson(cwd, ["--no-input", "srs", "install"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "installed");
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "skills", "fullstack-to-srs", "SKILL.md")));
    assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", "fullstack-to-srs", "SKILL.md")), false);
    assert.match(fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8"), /\.contextpilot\/skills\/fullstack-to-srs\/SKILL\.md/);
  });
});

test("srs install migrates legacy Claude skillPath to shared skillPath", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    const configPath = path.join(cwd, ".contextpilot", "harness.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.srs.skillPath = ".claude/skills/fullstack-to-srs";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const result = runJson(cwd, ["srs", "install"]);
    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));

    assert.equal(result.code, 0);
    assert.equal(updated.srs.skillPath, ".contextpilot/skills/fullstack-to-srs");
    assert.ok(fs.existsSync(path.join(cwd, ".contextpilot", "skills", "fullstack-to-srs", "SKILL.md")));
  });
});

test("srs install is idempotent and does not overwrite existing valid skill", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    runJson(cwd, ["srs", "install"]);
    const skillPath = path.join(cwd, ".contextpilot", "skills", "fullstack-to-srs", "SKILL.md");
    fs.appendFileSync(skillPath, "\ncustom local note\n", "utf8");

    const result = runJson(cwd, ["srs", "install"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "already_installed");
    assert.match(fs.readFileSync(skillPath, "utf8"), /custom local note/);
  });
});

test("srs install rejects existing invalid skill destination", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    fs.mkdirSync(path.join(cwd, ".contextpilot", "skills", "fullstack-to-srs"), { recursive: true });

    const result = runRaw(cwd, ["--json", "srs", "install"]);
    const parsed = JSON.parse(result.stderr || result.stdout);

    assert.notEqual(result.status, 0);
    assert.equal(parsed.error, "srs_skill_install_failed");
    assert.match(parsed.message, /Existing skill destination/);
  });
});

test("srs ingest keeps legacy flat module files compatible", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements.md",
      "# Section 3: Functional Requirements\n\n## Module: Auth\n\nLegacy auth body\n",
    );

    const result = runJson(cwd, ["srs", "ingest"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.knowledgeUpserted, 1);
    assert.match(readRule(cwd, "srs-03-auth"), /Legacy auth body/);
  });
});

test("srs ingest keeps full knowledge out of single-file agent targets by default", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nFR auth body with NEVER_INLINE_BODY marker\n",
    );

    const result = runJson(cwd, ["srs", "ingest"]);

    assert.equal(result.code, 0);
    const agentsMd = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
    const index = fs.readFileSync(
      path.join(cwd, ".contextpilot", "context", "knowledge-index.md"),
      "utf8",
    );

    assert.match(agentsMd, /# Project Knowledge/);
    assert.match(agentsMd, /knowledge relevant/);
    assert.match(agentsMd, /knowledge show/);
    assert.doesNotMatch(agentsMd, /NEVER_INLINE_BODY/);
    assert.match(index, /SRS 03: Auth/);
    assert.match(index, /- ID: srs-03-auth/);
    assert.match(index, /- Section: 03/);
    assert.match(index, /- Canonical: docs\/srs\/03-functional-requirements\/module-auth\.md/);
    assert.match(index, /NEVER_INLINE_BODY marker/);
    assert.match(readRule(cwd, "srs-03-auth"), /NEVER_INLINE_BODY marker/);
  });
});

test("single-file agent targets can opt back into inline knowledge", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    const config = readConfig(cwd);
    config.agentContext.knowledgeMode = "inline";
    writeConfig(cwd, config);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nFR auth body with INLINE_COMPAT marker\n",
    );

    const result = runJson(cwd, ["srs", "ingest"]);

    assert.equal(result.code, 0);
    assert.match(
      fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8"),
      /INLINE_COMPAT marker/,
    );
    assert.equal(
      fs.existsSync(path.join(cwd, ".contextpilot", "context", "knowledge-index.md")),
      false,
    );
  });
});

test("sync warns when a generated main agent file exceeds the configured size budget", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    const config = readConfig(cwd);
    config.agentContext.maxMainFileChars = 100;
    writeConfig(cwd, config);
    writeFile(
      cwd,
      ".contextpilot/rules/huge-rule.md",
      [
        "---",
        "id: huge-rule",
        "title: Huge Rule",
        "type: rule",
        "targets:",
        "  - codex",
        "---",
        "",
        "This rule is intentionally long. ".repeat(20),
      ].join("\n"),
    );

    const result = runJson(cwd, ["sync"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "synced");
    assert.ok(
      result.json.warnings.some((warning) =>
        warning.includes("Generated main agent file exceeds maxMainFileChars"),
      ),
    );
  });
});

test("status reports no SRS drift right after ingest, then flags stale and new files", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nOriginal auth body\n",
    );
    runJson(cwd, ["srs", "ingest", "--path", "docs/srs"]);

    const clean = runJson(cwd, ["status"]);
    assert.deepEqual(clean.json.srsDrift, []);

    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nEdited auth body\n",
    );
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-billing.md",
      "# Section 3: Functional Requirements - Module: Billing\n\nNew billing body\n",
    );

    const dirty = runJson(cwd, ["status"]);
    const byPath = Object.fromEntries(dirty.json.srsDrift.map((d) => [d.path, d.kind]));
    assert.equal(byPath["docs/srs/03-functional-requirements/module-auth.md"], "stale");
    assert.equal(byPath["docs/srs/03-functional-requirements/module-billing.md"], "new");

    const reingest = runJson(cwd, ["srs", "ingest", "--path", "docs/srs", "--reingest"]);
    assert.equal(reingest.code, 0);

    const afterReingest = runJson(cwd, ["status"]);
    assert.deepEqual(afterReingest.json.srsDrift, []);
  });
});

test("context --inject surfaces SRS drift so agents don't need to remember reingest", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nOriginal auth body\n",
    );
    runJson(cwd, ["srs", "ingest", "--path", "docs/srs"]);
    writeFile(
      cwd,
      "docs/srs/03-functional-requirements/module-auth.md",
      "# Section 3: Functional Requirements - Module: Auth\n\nEdited auth body\n",
    );

    const result = runJson(cwd, ["context", "--inject"]);

    assert.equal(result.code, 0);
    assert.match(result.json.text, /SRS Source Drift/);
    assert.match(result.json.text, /stale.*module-auth\.md/);
    assert.equal(result.json.srsDrift.length, 1);
    assert.equal(result.json.srsDrift[0].kind, "stale");
  });
});

test("fullstack-to-srs docs describe module files instead of a single section 8 append file", () => {
  const skillDir = path.join(__dirname, "..", "assets", "skills", "fullstack-to-srs");
  const combined = [
    "SKILL.md",
    "output-layout.md",
    "orchestration.md",
    "section-agents.md",
    "reference.md",
  ]
    .map((file) => fs.readFileSync(path.join(skillDir, file), "utf8"))
    .join("\n");

  assert.doesNotMatch(combined, /append module block to `08-use-cases-user-stories\.md`/i);
  assert.match(combined, /module-\[module-slug\]\.md/);
  assert.match(combined, /section README index/i);
});
