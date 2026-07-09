# ContextPilot

**ContextPilot** is a local-first control plane that gives AI coding agents (Claude Code, Cursor,
Codex, GitHub Copilot, Windsurf) persistent project context, memory, and a structured workflow —
without you having to operate a CLI yourself. You run one setup command; after that you just chat
with your agent normally, and the agent runs ContextPilot commands in the background.

Everything lives in a single `.contextpilot/` folder in your repo, generated into each agent's
native instruction files (`CLAUDE.md`, `.cursor/rules/*.mdc`, `AGENTS.md`, etc.) so every agent
you use reads the exact same protocol and project knowledge.

## Why

AI agents forget everything between sessions and drift out of sync with a project's real state:
they re-learn the same lessons, silently keep stale copies of requirements docs, and leave
half-finished multi-step tasks with no record of what's left. ContextPilot fixes this by giving
agents:

- a place to **persist** what they've learned (mistakes, constraints, decisions) across sessions,
- a **workflow** (plan → implement → review → verify → checkpoint) for non-trivial tasks, with a
  gate that blocks file edits outside the current step's scope,
- a **discussion gate** that forces the agent to ask you before guessing at business logic, and
- **drift detection**: whenever a tracked file (SRS docs, generated instructions, ingested
  knowledge rules) falls out of sync with what the agent last saw, `status`/`context --inject`
  surface it instead of silently serving stale information.

## Supported agents

| Agent | Hook coverage |
|---|---|
| Claude Code | Full — PreToolUse deny, SessionStart inject, Stop checkpoint |
| Cursor | Full — pre-shell/pre-MCP deny, post-edit revert, session hooks |
| Codex | Best-effort (writes `AGENTS.md`; hook surface not guaranteed on every version) |
| GitHub Copilot | Instructions file only — no hook API; git pre-commit is the backstop |
| Windsurf | Instructions file only — git pre-commit is the backstop |

Every agent that has no hook support still gets the git pre-commit backstop, so business-logic
edits can't slip through unnoticed even without agent-native hooks.

## Installation

```bash
npm install -g @async-nguyen/contextpilot
```

(Or add it as a dev dependency and use `npx --no-install contextpilot ...` instead of a global install.)

## Quick start

```bash
cd your-project
contextpilot setup
contextpilot start
```

That's it. `setup` auto-detects which agents you use, scaffolds `.contextpilot/`, installs hooks
and a git pre-commit backstop, ingests `docs/srs/` if it exists, and regenerates every agent's
instruction files. From here, open your AI coding agent and describe what you want — the agent
reads the generated instructions and drives ContextPilot itself.

For headless/CI setup with no prompts:

```bash
contextpilot setup --json --no-input
```

If the global binary is not installed but the repo has a local install, ContextPilot now reports the
exact fallback command to use, for example:

```bash
npx --no-install contextpilot doctor
```

## What `setup` does

1. **Detects agents** already configured in the repo (`.claude/`, `.cursor/`, `AGENTS.md`,
   `.github/copilot-instructions.md`, `.windsurf/`) — Codex is always included so `AGENTS.md`
   is generated even on a fresh repo.
2. **Scaffolds** `.contextpilot/` (rules, memory, context, decisions, orchestration).
3. Installs **gate hooks** for detected agents plus a git `pre-commit` backstop.
4. **Ingests `docs/srs/`** if present, or marks the project as SRS-missing (greenfield).
5. **Auto-discovers** any pre-existing agent rules/skills in the repo and adopts them as
   low-priority knowledge.
6. **Syncs** — writes the generated instruction files for every detected agent.

## Core concepts

| Concept | What it holds | Where |
|---|---|---|
| Long-term context | Architecture, conventions, business rules, ingested SRS knowledge | `.contextpilot/rules/*.md` |
| Short-term focus | What the current task is | `.contextpilot/context/current.md` |
| Memory | Learnings from past mistakes/constraints | `.contextpilot/memory/learnings.jsonl` |
| Orchestration | Active run, workflow steps, trace events | `.contextpilot/orchestration/*.jsonl` |
| Decisions | Open/resolved business-logic questions | `.contextpilot/decisions/decisions.jsonl` |

### The discussion gate

When an agent is uncertain about a business-logic decision, it must not guess — it opens a
discussion, asks you in chat, and only proceeds once you've answered:

```
Agent uncertain about requirements
  -> contextpilot decision open --question "..." --scope "src/**" --json
  -> asks you in chat, waits for your answer
  -> contextpilot decision resolve --id <id> --resolution "..." --json
  -> a rule is generated from the resolution -> gate allows changes in that scope
```

While a decision is **open**, `gate check` (agent hooks) and `gate precommit` (git backstop) both
deny edits/commits in the affected scope, and `status --json` reports `inDiscussion: true`.

### Orchestration workflow

For non-trivial coding tasks, an agent starts a structured run:

```bash
contextpilot orchestrate start --goal "Add refund policy validation" --scope "src/billing/**" --json
```

The run walks through 5 built-in steps — `plan` → `implement` → `review` → `verify` →
`checkpoint` — each with a role and instructions injected via `context --inject`. The agent
advances a step when it's done:

```bash
contextpilot orchestrate advance --status complete --note "Plan reviewed" --json
```

`gate check` is step-aware: it blocks file edits outside the run's scope, and blocks edits
entirely during non-edit steps (`plan`, `review`). Running `contextpilot checkpoint` while the
run is at its final `checkpoint` step automatically completes the run — no separate
`orchestrate advance` call needed for that case.

### SRS (requirements) integration

If your project has a `docs/srs/` folder, `contextpilot srs ingest` turns it into scoped
knowledge rules an agent can query by file path or topic, instead of dumping the whole
document into every agent's context window.

```bash
contextpilot srs status --json
contextpilot srs ingest --path docs/srs --reingest --json
```

For a greenfield project with no SRS yet, `contextpilot srs bootstrap` scaffolds `docs/srs/`
and installs a skill (`fullstack-to-srs`) that walks an agent through writing one from the
existing codebase.

**Whenever an SRS file is edited, re-run `srs ingest --reingest`.** If you forget, ContextPilot
still tells you — see Drift detection below.

## Drift detection

ContextPilot tracks the last-seen hash of everything it depends on, and reports when reality has
moved without it. All of these show up in `contextpilot status --json` (and the relevant ones
also in `context --inject`, which agents read every session):

| Field | Meaning | Fix |
|---|---|---|
| `drift` | A generated file (e.g. `CLAUDE.md`) was hand-edited since ContextPilot last wrote it | `contextpilot sync` |
| `srsDrift` | An SRS source file (`docs/srs/**/*.md`) is new or changed since the last ingest | `contextpilot srs ingest --reingest` |
| `ruleDrift` | An ingested rule file (`.contextpilot/rules/*.md`) was hand-edited since ContextPilot last wrote it | Re-run the ingest that produced it, or hand-edit the SRS source instead |
| `staleDecisionScopes` | A decision's `--scope` glob matches zero files (typo, or the code was deleted/renamed) | Fix or close the decision |
| `orchestration.staleHours` | An active orchestration run has had no activity for 24+ hours | Resume it or `orchestrate cancel` |

None of these block anything by default — they're visibility, not enforcement, so a human or
agent can decide what to do about them.

## Safe start and lightweight commands

Use `contextpilot start` for a one-command readiness check. It reports how the CLI was resolved
(project-local package, dev repo, or `npx --no-install` fallback), whether the repo is initialized,
the current SRS/orchestration state, and the next recommended command.

For small technical tasks, use the lightweight path:

```bash
contextpilot start
contextpilot status --fast
contextpilot sync --preview
```

- `status --fast` skips expensive scans and returns a minimal, reliable summary.
- `sync --preview` shows what would change without rewriting files.
- `orchestrate start` is still the structured workflow command for non-trivial tasks; it is
  separate from the new top-level `start` readiness command.

## CLI reference

Most of these are meant to be run **by the agent**, not by you — after `setup`, you just chat.

| Command | Who runs it | Description |
|---|---|---|
| `start` | Human / agent | Safe-start readiness summary and next-step recommendation |
| `setup` | Human, once | One-time project setup |
| `doctor` | Human / CI | Verify installation, hooks, and generated files |
| `status` | Agent | Drift, pending rules, open decisions, orchestration state (`--fast` for lightweight mode) |
| `context --inject` | Agent | Session-start context (focus, learnings, decisions, orchestration, drift) |
| `learn` | Agent | Record a mistake/constraint learned this session |
| `sync` | Agent | Regenerate every agent's instruction files (`--preview` to inspect first) |
| `checkpoint` | Agent | End-of-task: sync + learn nudge + auto-complete orchestration if applicable |
| `focus` | Agent | Update the current task focus |
| `orchestrate start` / `advance` / `status` / `cancel` / `event` | Agent | Structured workflow control |
| `decision open` / `list` / `resolve` / `reject` | Agent (resolve may need you) | Business-logic discussion gate |
| `srs status` / `bootstrap` / `ingest` / `install` | Agent | Requirements-doc ingestion |
| `knowledge query` / `relevant` / `show` | Agent | Look up ingested knowledge |
| `gate check` / `precommit` / `install` | Agent / hook / git | Enforcement |
| `refresh --auto` | Agent | Adopt newly discovered external rules/skills |
| `watch` | Agent | Background sync; reverts gated Cursor edits |
| `discover` / `add` / `forget` | **Human** | Import or delete rules — requires your explicit say-so |
| `init` | Human (or `--yes` headless) | Lower-level version of `setup` |

Run `contextpilot <command> --help` for flags, or add `--json` to any command for machine-readable
output.

## Configuration

Project settings live in `.contextpilot/harness.config.json`. The most commonly touched options:

- `gate.mode`: `"sensitive-only"` (default, only SRS-linked scopes) or `"strict"` (all
  `gate.businessScopes` globs).
- `srs.bootstrapMode`: `"nudge"` (default, coding isn't blocked) or `"strict"` (business-scope
  edits denied while SRS status is `missing`; `docs/srs/**` edits stay allowed).
- `agentContext.knowledgeMode`: `"manifest"` (default for single-file agents — points at
  `.contextpilot/context/knowledge-index.md` instead of inlining SRS bodies) or `"inline"`.
- `agentContext.globalKnowledgePolicy`: `"summary"` (default — compact SRS tables in agent files;
  full text via `knowledge show`) or `"full"` / `"index-only"`.
- `agentContext.listKnowledgeInMainFile`: `"compact"` (default — no 50-line knowledge list),
  `"full"` (legacy list), or `"none"`.
- `agentContext.relevantDefaultSections`: default `["07", "03"]` for `knowledge relevant`.
- `agentContext.relevantDefaultLimit`: default `2` results per relevant query.
- `discover.paths`: override where ContextPilot looks for pre-existing global agent config.

### Knowledge workflow (v0.4+)

Agent instruction files now contain **SRS summaries only**. Load full requirements on demand:

```bash
contextpilot knowledge relevant --file api/inventory/service.ts --task code --limit 2 --json
contextpilot knowledge show srs-07-inventory
```

`knowledge show` resolves the full body from the canonical SRS source when ingest hashes match; if the SRS file changed without re-ingest, JSON output includes `driftWarning` and the ingested rule body is used instead.

Cursor scoped `.mdc` rules still carry full module SRS bodies when you edit matching paths.

### Migration from 0.3.x

After upgrading to 0.4.0, re-ingest and sync your project:

```bash
contextpilot srs ingest --path docs/srs --reingest --json
contextpilot sync --json
```

To restore the old behavior (full SRS inline in agent files), set in
`.contextpilot/harness.config.json`:

```json
{
  "agentContext": {
    "globalKnowledgePolicy": "full",
    "listKnowledgeInMainFile": "full"
  }
}
```

## Examples

```bash
# Record a learning
contextpilot learn --category constraint --severity med \
  --title "API errors must be typed" \
  --detail "Never empty catch; use instanceof Error" \
  --scope "src/**" --json

# Open and resolve a business-logic discussion
contextpilot decision open --question "Should refunds be partial or full-only?" \
  --scope "src/billing/**" --json
contextpilot decision resolve --id dec_abc --resolution "Partial refunds up to 90 days" --json

# Run a structured task
contextpilot orchestrate start --goal "Implement partial refunds" --scope "src/billing/**" --json
contextpilot orchestrate advance --status complete --note "Plan complete" --json
contextpilot checkpoint --json   # auto-completes the run if at its final step

# Requirements ingestion
contextpilot srs bootstrap --json
contextpilot srs ingest --path docs/srs --reingest --json

# Quick readiness / lightweight flow
contextpilot start
contextpilot status --fast
contextpilot sync --preview

# Check for anything out of sync
contextpilot status --json
```

## Limitations

- Agents may not always self-initiate `learn` — seed important learnings yourself early on.
- Cursor's `afterFileEdit` revert has a window between edit and revert; git pre-commit is the
  hard boundary.
- Codex/Copilot/Windsurf hook coverage is best-effort or commit-only — verify against your
  agent's current hook API.
- Cursor User Rules and Copilot's global instructions live in app settings and can't be
  auto-detected.
- Hooks prefer a project-local install when available, then fall back to the current dev checkout,
  then to `npx --no-install contextpilot`.
- Drift/staleness fields are visibility only — nothing is auto-reverted or auto-blocked from them.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error, or `status` reporting unresolved issues (drift, open discussion, etc.) |
| 2 | Missing required flag |
| 3 | Requires human interaction (human-gated command run headless) |
| 4 | Unresolved drift during an interactive sync |

## Development

```bash
git clone https://github.com/Async-Ng/contextpilot.git
cd contextpilot
npm install
npm run build
npm test
node dist/index.js --help
```

See `CHANGELOG.md` for release history.
