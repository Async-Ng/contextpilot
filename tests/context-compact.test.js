const assert = require("node:assert/strict");
const test = require("node:test");
const { buildGlobalKnowledgeSummary } = require("../dist/core/knowledge-summary");
const { sortLearnings } = require("../dist/core/memory");

test("global summary keeps complete table rows inside its budget", () => {
  const rules = Array.from({ length: 8 }, (_, i) => ({
    id: `srs-${i + 1}`, section: "07", title: `Section ${i + 1} with a long descriptive title`, body: "BR-ABC-001. A complete sentence.",
  }));
  const summary = buildGlobalKnowledgeSummary({ agentContext: { globalSummaryMaxChars: 240 } }, rules);
  assert.ok(summary.length <= 240);
  assert.doesNotMatch(summary, /\.\.\.|Syst\.\.\./);
  for (const line of summary.split("\n").filter((line) => line.startsWith("|"))) {
    assert.equal(line.split("|").length, 6);
  }
});

test("explicit supersession hides old learning without mutating records", () => {
  const old = { id: "lrn_old", sourceItemId: "CR-033", title: "Old rule", detail: "Old detail", pinned: false, severity: "med", createdAt: "2025-01-01" };
  const next = { id: "lrn_next", title: "New rule", detail: "CR-052 supersedes CR-033", pinned: false, severity: "med", createdAt: "2025-02-01" };
  assert.deepEqual(sortLearnings([old, next]).map((item) => item.id), ["lrn_next"]);
  assert.equal(old.sourceItemId, "CR-033");
});
