const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.join(__dirname, "..", "dist", "index.js");

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-commit-"));
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
    spawnSync("node", [CLI, "--json", "setup", "--no-git"], { cwd: dir, encoding: "utf8" });
    execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: dir, stdio: "pipe" });
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

function writeFile(cwd, relPath, content) {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

test("commit-status classifies product, durable context, and generated context", () => {
  withProject((cwd) => {
    writeFile(cwd, "src/app.ts", "export const value = 1;\n");
    fs.appendFileSync(path.join(cwd, ".contextpilot", "memory", "learnings.jsonl"), "\n", "utf8");
    fs.appendFileSync(path.join(cwd, "AGENTS.md"), "\nmanual generated edit\n", "utf8");

    const result = runJson(cwd, ["commit-status"]);

    assert.equal(result.code, 0);
    assert.deepEqual(result.json.productChanges, ["src/app.ts"]);
    assert.ok(result.json.durableContext.includes(".contextpilot/memory/learnings.jsonl"));
    assert.ok(result.json.generatedContext.includes("AGENTS.md"));
    assert.ok(result.json.recommendedCommitPaths.includes("src/app.ts"));
  });
});
