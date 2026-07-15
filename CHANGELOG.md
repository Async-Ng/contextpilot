# Changelog

## 0.4.2 - Light profile defaults

### Added

- New light-profile config defaults: `profile`, `hooks.infrastructureFailure`,
  `orchestration.autoStart`, `agentContext.protocolLevel`, and `srs.autoIngestOnDrift`.
- Safe SRS drift auto-ingest for `status`, `context --inject`, and `sync` when no rule-file drift
  conflict would be overwritten.

### Changed

- **Default UX is now light**: agent files use a stub protocol and index-only global knowledge,
  small technical tasks do not require orchestration, and hook infrastructure failures warn-open.
- Sync preview now includes generated-size deltas.
- README guidance now covers when ContextPilot is worth it, the small-task fast path, and how to
  opt into `"profile": "strict"` for team/governance workflows.

## 0.4.1 - CLI reliability and lightweight UX

### Added

- New `contextpilot start` readiness command: reports CLI resolution, initialization state, SRS /
  orchestration readiness, and recommends the next command to run.
- `status --fast` lightweight mode with per-stage diagnostics and partial-result reporting.
- `sync --preview` alias for previewing sync changes before writing.
- New UX coverage in `tests/cli-ux.test.js` for command resolution, readiness, fast status, and
  preview sync behavior.

### Changed

- Shared command-resolution logic now prefers project-local installs, then the current dev checkout,
  then `npx --no-install contextpilot`, and reuses that guidance in CLI messaging.
- Fixed dev-repo command resolution for the published package name `@async-nguyen/contextpilot`.
- `status` now runs through timed diagnostic stages and degrades gracefully when a section fails or
  is skipped.
- Sync avoids rewriting unchanged generated files and reports `written`, `unchanged`, and `skipped`
  outputs separately.
- Updated README guidance for local-install fallback, `start`, `status --fast`, and `sync --preview`.

## 0.4.0 - Knowledge layer optimization (multi-agent)

### Added

- SRS ingest now writes extended rule metadata: `section`, `module`, `canonicalSource`, `srsKind`,
  and section-aware `priority`/`tags`.
- `knowledge query` / `relevant` support `--sections`, `--module`, and `--task` (code|data|test|explore)
  with task-aware section ranking and module grouping (default limit 2 for relevant).
- `knowledge show` resolves full body from `canonicalSource` when SRS hash matches state.
- `knowledge-policy.ts` — agent-aware read policy resolver (`skip-body-read`, `knowledge-show-once`).
- `knowledge-summary.ts` — compact global SRS summary tables for agent files.
- `context --inject` now includes **Suggested Knowledge** pointers from orchestration scope.
- New config: `globalKnowledgePolicy` (`summary` | `full` | `index-only`), `globalSummaryMaxChars`,
  `relevantDefaultSections`, `relevantDefaultLimit`, `relevantGroupByModule`, `listKnowledgeInMainFile`.
- `globalKnowledgePolicy: "index-only"` — agent files link to `knowledge-index.md` only (no summary
  table); full global SRS remains in `_srs-global.mdc` for on-demand use.
- Cursor: `_srs-global.mdc` on-demand file; `_project.mdc` uses summary instead of full global SRS.
- `knowledge show` JSON includes `driftWarning` when canonical SRS source hash drifts from ingest state.
- Tests: `sync-knowledge.test.js`; extended `knowledge.test.js` and `srs-ingest.test.js`.

### Changed

- **Breaking default**: agent files (`AGENTS.md`, `CLAUDE.md`, `_project.mdc`) now contain SRS
  summaries only; full text via `contextpilot knowledge show <id>`.
- Protocol updated: agents must not assume full SRS is in context; use `knowledge show` on demand.
- Knowledge index includes `section`, `module`, and `canonicalSource` columns.

## 0.3.7 - Recognize tombstone (removed-module) SRS docs

### Added

- `srs ingest` now recognizes a `## Module Removed` heading at the start of a module's body as a
  convention for "this module was intentionally kept as a historical removal note" - such rules
  are tagged `removed` and given `priority: low` instead of being treated like ordinary active
  knowledge. Documented in `assets/skills/fullstack-to-srs/output-layout.md`.
- `status --json` now reports `staleRuleScopes`: ingested rules whose `scope` glob matches zero
  files on disk (the same staleness check `staleDecisionScopes` already does for decisions), with
  `removed`-tagged rules excluded since a dead scope there is expected, not a mistake.

### Changed

- Extracted a shared `globHasMatches` helper (`src/core/scope-match.ts`) used by both
  `getStaleDecisionScopes` and the new `getStaleRuleScopes`, replacing the decision-only inline
  `fast-glob` check.

## 0.3.6 - Rule-file drift protection and stale decision scopes

### Added

- `.contextpilot/rules/*.md` files are now hash-tracked when written by `srs ingest`; a
  hand-edit since the last write is detected and warned about instead of being silently
  overwritten on the next reingest. Surfaced under `status --json`'s new `ruleDrift` field.
- `status --json` now reports `staleDecisionScopes`: open or resolved decisions whose `--scope`
  glob matches zero files on disk (a typo'd glob, or code that was since deleted/renamed).

### Changed

- Extracted a shared `diffHashes` helper (`src/core/drift.ts`) used by generated-file drift,
  SRS source-file drift, and the new rule-file drift check, replacing three independent
  hand-rolled implementations with one.
- Documented in `orchestration.ts` that `allowedActions` on orchestration steps are role-scoping
  hints, not an enforcement mechanism (`"edit"` is the only value ever mechanically checked).

## 0.3.5 - SRS drift visibility and checkpoint/orchestration linkage

### Added

- Per-file SRS source hash tracking on ingest; `status --json` and `context --inject` now
  report stale/never-ingested SRS files under `srsDrift` instead of silently serving outdated
  knowledge.
- `contextpilot checkpoint` now completes the active orchestration run automatically when its
  current step is the final `checkpoint` step, and otherwise emits an explicit warning instead
  of silently leaving the run active.
- `staleHours` on the orchestration summary, surfaced as a warning in `status` when an active
  run has had no activity for over 24 hours.

### Changed

- ContextPilot Protocol text updated to describe the reingest-after-edit requirement and the
  checkpoint auto-complete behavior, shared identically across all agent adapters.

## 0.3.4 - Greenfield SRS bootstrap

### Added

- Greenfield SRS-first bootstrap state, protocol nudges, and `contextpilot srs bootstrap/status`.
- Strict SRS bootstrap gate mode for blocking business edits until SRS bootstrap starts.

## 0.3.0 - Public beta

### Added

- `contextpilot setup` as the recommended one-time project setup command.
- Prescriptive orchestration control plane with run/step state, role guidance, and trace events.
- Invisible agent protocol so humans can chat normally while agents run ContextPilot commands.
- Step-aware gate enforcement for active orchestration runs.
- `fullstack-to-srs` module-folder output layout for Sections 03, 06, 07, and 08.
- Backward-compatible SRS ingest for both nested module folders and legacy flat files.
- Node test suite covering setup, orchestration, gate behavior, SRS ingest, and package readiness.

### Changed

- Public identity renamed to `ContextPilot`.
- Package is now `@async-nguyen/contextpilot`; CLI binary remains `contextpilot`.
- Project storage moved to `.contextpilot/`, with setup migration from legacy `.harness/`.
- README quick start now uses the `contextpilot` npm package name.

### Notes

- This is a public beta release.
- Hook support still depends on each agent's available hook surface.
- Copilot and Windsurf remain commit-backstop oriented where direct hook support is limited.
