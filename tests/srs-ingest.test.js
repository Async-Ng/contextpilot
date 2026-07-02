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

function writeFile(cwd, relPath, content) {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function readRule(cwd, id) {
  return fs.readFileSync(path.join(cwd, ".contextpilot", "rules", `${id}.md`), "utf8");
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
    assert.equal(
      fs.existsSync(path.join(cwd, ".contextpilot", "rules", "srs-03-section-3-index.md")),
      false,
    );
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
