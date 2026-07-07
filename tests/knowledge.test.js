const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-knowledge-"));
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

function writeKnowledge(cwd, id, frontmatter, body) {
  const lines = ["---"];
  for (const line of frontmatter) {
    lines.push(line);
  }
  lines.push("---", "", body);
  writeFile(cwd, `.contextpilot/rules/${id}.md`, lines.join("\n"));
}

function setupKnowledgeProject(cwd) {
  runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
  writeKnowledge(
    cwd,
    "srs-03-auth",
    [
      "id: srs-03-auth",
      'title: "SRS 03: Auth"',
      "type: knowledge",
      "priority: high",
      "section: '03'",
      "module: auth",
      "scope:",
      "  - src/auth/**",
      "targets:",
      "  - codex",
      "  - cursor",
      "tags:",
      "  - security",
      "  - auth",
    ],
    "Authentication requirements include password policy and session renewal.",
  );
  writeKnowledge(
    cwd,
    "srs-03-billing",
    [
      "id: srs-03-billing",
      'title: "SRS 03: Billing"',
      "type: knowledge",
      "priority: normal",
      "scope:",
      "  - src/billing/**",
      "targets:",
      "  - codex",
    ],
    "Billing requirements include invoice creation and payment reconciliation.",
  );
  writeKnowledge(
    cwd,
    "srs-03-claude-only",
    [
      "id: srs-03-claude-only",
      'title: "SRS 03: Claude Only Auth"',
      "type: knowledge",
      "priority: high",
      "scope:",
      "  - src/auth/**",
      "targets:",
      "  - claude",
    ],
    "Auth knowledge that should not appear for codex target filtering.",
  );
}

test("knowledge query ranks text matches and omits body by default", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, ["knowledge", "query", "--query", "auth"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.query, "auth");
    assert.equal(result.json.results[0].id, "srs-03-auth");
    assert.equal(result.json.results.some((item) => item.id === "srs-03-billing"), false);
    assert.equal(Object.hasOwn(result.json.results[0], "body"), false);
    assert.match(result.json.results[0].source, /\.contextpilot\/rules\/srs-03-auth\.md/);
  });
});

test("knowledge relevant ranks file-scope matches first", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "relevant",
      "--file",
      "src/auth/login.ts",
    ]);

    assert.equal(result.code, 0);
    assert.deepEqual(result.json.files, ["src/auth/login.ts"]);
    assert.equal(result.json.results[0].id, "srs-03-auth");
    assert.ok(result.json.results[0].reasons.includes("file:src/auth/login.ts"));
  });
});

test("knowledge query supports target filtering, limits, and include-body", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "query",
      "--query",
      "auth",
      "--target",
      "codex",
      "--limit",
      "1",
      "--include-body",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.target, "codex");
    assert.equal(result.json.limit, 1);
    assert.equal(result.json.results.length, 1);
    assert.equal(result.json.results[0].id, "srs-03-auth");
    assert.match(result.json.results[0].body, /Authentication requirements/);
  });
});

test("knowledge show returns full content for one item", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, ["knowledge", "show", "srs-03-auth"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.id, "srs-03-auth");
    assert.match(result.json.body, /password policy/);
    assert.match(result.json.source, /\.contextpilot\/rules\/srs-03-auth\.md/);
  });
});

test("knowledge show reports unknown ids clearly", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, ["knowledge", "show", "missing-id"]);

    assert.notEqual(result.code, 0);
    assert.equal(result.json.error, "knowledge_not_found");
    assert.equal(result.json.id, "missing-id");
  });
});

function setupMultiSectionProject(cwd) {
  runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
  const sections = ["03", "06", "07", "08"];
  for (const section of sections) {
    writeKnowledge(
      cwd,
      `srs-${section}-inventory`,
      [
        `id: srs-${section}-inventory`,
        `title: "SRS ${section}: Inventory"`,
        "type: knowledge",
        "priority: normal",
        `section: "${section}"`,
        "module: inventory",
        "scope:",
        "  - api/inventory/**",
        "targets:",
        "  - codex",
        `tags:`,
        `  - srs-${section}`,
      ],
      `Section ${section} inventory requirements.`,
    );
  }
}

test("knowledge relevant limits by section and groups by module", () => {
  withTempProject((cwd) => {
    setupMultiSectionProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "relevant",
      "--file",
      "api/inventory/service.ts",
      "--sections",
      "07,03",
      "--limit",
      "2",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.results.length, 2);
    const sections = result.json.results.map((r) => r.section);
    assert.ok(sections.includes("07"));
    assert.ok(sections.includes("03"));
    assert.equal(result.json.results.every((r) => r.module === "inventory"), true);
  });
});

test("knowledge query filters by module slug", () => {
  withTempProject((cwd) => {
    setupMultiSectionProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "query",
      "--query",
      "inventory",
      "--module",
      "inventory",
      "--sections",
      "07",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.results.length, 1);
    assert.equal(result.json.results[0].id, "srs-07-inventory");
    assert.equal(result.json.results[0].module, "inventory");
  });
});

test("knowledge show resolves canonical source when hash matches", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    writeFile(
      cwd,
      "docs/srs/07-business-rules/module-auth.md",
      "# Section 7: Business Rules - Module: Auth\n\nCANONICAL_BODY_MARKER\n",
    );
    runJson(cwd, ["srs", "ingest", "--path", "docs/srs", "--reingest"]);

    const result = runJson(cwd, ["knowledge", "show", "srs-07-auth"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.resolvedFrom, "canonical");
    assert.match(result.json.body, /CANONICAL_BODY_MARKER/);
    assert.match(result.json.source, /docs\/srs\/07-business-rules\/module-auth\.md/);
  });
});

test("knowledge results include readPolicy and deliveryHint", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "relevant",
      "--file",
      "src/auth/login.ts",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.results[0].readPolicy, "knowledge-show-once");
    assert.match(result.json.results[0].deliveryHint, /knowledge show/);
  });
});

test("knowledge show falls back to rule body when canonical hash drifts", () => {
  withTempProject((cwd) => {
    runJson(cwd, ["setup", "--no-git", "--agent", "codex"]);
    writeFile(
      cwd,
      "docs/srs/07-business-rules/module-auth.md",
      "# Section 7: Business Rules - Module: Auth\n\nCANONICAL_BODY_MARKER\n",
    );
    runJson(cwd, ["srs", "ingest", "--path", "docs/srs", "--reingest"]);

    writeFile(
      cwd,
      "docs/srs/07-business-rules/module-auth.md",
      "# Section 7: Business Rules - Module: Auth\n\nDRIFTED_CANONICAL_BODY\n",
    );

    const result = runJson(cwd, ["knowledge", "show", "srs-07-auth"]);

    assert.equal(result.code, 0);
    assert.equal(result.json.resolvedFrom, "rule");
    assert.match(result.json.driftWarning, /Canonical source drift/);
    assert.doesNotMatch(result.json.body, /DRIFTED_CANONICAL_BODY/);
    assert.match(result.json.source, /\.contextpilot\/rules\/srs-07-auth\.md/);
  });
});

test("knowledge relevant uses skip-body-read for cursor scoped matches", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "relevant",
      "--file",
      "src/auth/login.ts",
      "--target",
      "cursor",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.target, "cursor");
    assert.equal(result.json.results[0].readPolicy, "skip-body-read");
    assert.match(result.json.results[0].deliveryHint, /Scoped Cursor rules/);
  });
});

test("knowledge relevant uses knowledge-show-once for codex", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);

    const result = runJson(cwd, [
      "knowledge",
      "relevant",
      "--file",
      "src/auth/login.ts",
      "--target",
      "codex",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.target, "codex");
    assert.equal(result.json.results[0].readPolicy, "knowledge-show-once");
    assert.match(result.json.results[0].deliveryHint, /knowledge show/);
  });
});

test("knowledge relevant uses legacy-full in inline knowledge mode", () => {
  withTempProject((cwd) => {
    setupKnowledgeProject(cwd);
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, ".contextpilot", "harness.config.json"), "utf8"),
    );
    config.agentContext.knowledgeMode = "inline";
    fs.writeFileSync(
      path.join(cwd, ".contextpilot", "harness.config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );

    const result = runJson(cwd, [
      "knowledge",
      "relevant",
      "--file",
      "src/auth/login.ts",
      "--target",
      "codex",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.results[0].readPolicy, "legacy-full");
    assert.match(result.json.results[0].deliveryHint, /Inline knowledge mode/);
  });
});
