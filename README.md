# ContextPilot

ContextPilot (`contextpilot`) is a local control plane that lets humans chat normally with AI coding agents while the agents run the ContextPilot protocol themselves. It manages **context + memory + orchestration** for Claude Code, Cursor, Codex, Windsurf, and GitHub Copilot from a single source of truth in `.contextpilot/`.

## Three-layer model

| Layer | Purpose | Location |
|-------|---------|----------|
| **Long context** | Architecture, conventions, business rules | `.contextpilot/rules/*.md` |
| **Short context** | Current task / focus | `.contextpilot/context/current.md` |
| **Memory** | Learnings from mistakes & constraints | `.contextpilot/memory/learnings.jsonl` |
| **Orchestration** | Active run, workflow steps, trace events | `.contextpilot/orchestration/*.jsonl` |

v0.2 adds a **discussion gate** (`.contextpilot/decisions/decisions.jsonl`) and **enforcement hooks** so agents cannot silently change business logic while a question is open.

v0.3 adds a local **orchestration control plane** (`.contextpilot/orchestration/`) for prescriptive task runs, workflow steps, role guidance, step-aware gates, and JSONL trace events.

## Human workflow

Humans only need one setup command per project:

```bash
npm install -g @async-nguyen/contextpilot
cd your-project
contextpilot setup
```

After that, chat with your AI agent normally. The generated agent instructions and hooks tell the agent to inject context, start orchestration, advance steps, record learnings, enforce gates, and checkpoint without asking you to operate the CLI.

## Zero-touch setup

For headless or CI-friendly bootstrap, `setup` wraps the zero-touch pipeline:

```bash
npm install -g @async-nguyen/contextpilot
cd your-project
contextpilot setup --json --no-input
```

This runs the full pipeline without prompts:

1. **Detect agents** - scan `.claude/`, `.cursor/`, `AGENTS.md`, `.github/copilot-instructions.md`, `.windsurf/`; always includes Codex so `AGENTS.md` is generated
2. **Scaffold** `.contextpilot/` (rules, memory, context, decisions, orchestration)
3. **`gate install`** - deep-merge hooks for detected agents + git pre-commit backstop
4. **SRS ingest** if `docs/srs/` exists
5. **Auto-discover** external rules/skills (knowledge, low priority, no prompts)
6. **`sync`** - regenerate agent target files

Interactive setup (`contextpilot init` without `--yes`) keeps the v0.1 wizard. Headless without `--yes` exits code `2` with a hint to use `--yes`.

`init --yes` remains available as a lower-level command, but `setup` is the recommended user-facing entrypoint.

After zero-touch init, the agent only needs **chat** for business decisions - everything else is protocol-driven.

## Discussion gate flow

When an agent is uncertain about business logic, it must not guess:

```
Agent uncertain about requirements
  -> contextpilot decision open --question "..." --scope "src/**" --json
  -> ask user in chat and wait
  -> contextpilot decision resolve --id <id> --resolution "..." --json
  -> rule decision-<id> synced -> gate allows changes in scope
```

While a decision is **open**:

- `status --json` reports `inDiscussion: true` and `openDecisions`
- `gate check` (agent hooks) **denies** edits/commands in gated scopes
- `gate precommit` (git backstop) **blocks** commits
- `watch` may **revert** file changes in business scopes (Cursor `afterFileEdit`)

`decision resolve` with `confirmMode: "chat"` (default) allows the agent to resolve in chat even headless. `"terminal"` / `"high-severity-terminal"` require a human TTY for resolve.

## Three enforcement tiers

| Tier | Mechanism | When it fires |
|------|-----------|---------------|
| **1 - Agent hooks** | `gate install` -> `gate check --agent <name>` | Pre-tool / pre-shell / pre-MCP (agent-specific) |
| **2 - Post-edit revert** | Cursor `afterFileEdit` + `watch` | After a denied file edit (git checkout + `.contextpilot/REVERTED.md`) |
| **3 - Git backstop** | `.git/hooks/pre-commit` -> `gate precommit` | Hard boundary at commit time |

### Per-agent expectations

| Agent | Pre-block | Revert | Commit-only | Notes |
|-------|-----------|--------|-------------|-------|
| **Claude Code** | yes | no | no | PreToolUse deny via exit 2; SessionStart -> `context --inject`; Stop -> `checkpoint` |
| **Cursor** | yes | yes | no | `beforeShellExecution`, `beforeMCPExecution`, `afterFileEdit`; session hooks for inject/checkpoint |
| **Codex** | best-effort | no | partial | Hook surface VERIFY - may rely on git backstop |
| **Copilot** | no | no | yes | No hook API confirmed in v0.2 - git pre-commit only |
| **Windsurf** | no | no | yes | Hook install not supported in v0.2 - git pre-commit only |
| **git** | no | no | yes | Pre-commit runs `contextpilot gate precommit` |

Run `contextpilot gate install --json` to see the enforcement table for your project.

Gate modes (`harness.config.json` -> `gate.mode`):

- **`sensitive-only`** (default) - SRS-linked learnings + `srs.moduleMap` scopes
- **`strict`** - all `gate.businessScopes` globs

## Learning loop

```
Agent works -> makes mistake / finds constraint
  -> contextpilot learn ...
  -> learning stored in memory
  -> checkpoint: contextpilot sync
  -> "Learned Constraints" injected into agent files
  -> next session reads constraints -> avoids repeat mistakes
```

Session hooks (installed by `gate install`):

- **Start:** `contextpilot context --inject` - focus, pinned learnings, open decisions
- **Stop:** `contextpilot checkpoint` - sync + nudge to run `learn`

## Orchestration control plane

Start a prescriptive coding workflow when an agent needs a structured run:

```bash
contextpilot orchestrate start \
  --goal "Add refund policy validation" \
  --scope "src/billing/**" \
  --json
```

The active run is injected into `context --inject` as **Active Orchestration**. The agent follows the current role and step:

1. `plan` - planner role, no file edits
2. `implement` - implementer role, edits allowed only inside run scope
3. `review` - reviewer role, no file edits by default
4. `verify` - verifier role, tests/build/checks expected
5. `checkpoint` - record learnings, sync, and summarize

When a step is done, the agent advances it:

```bash
contextpilot orchestrate advance --status complete --note "Plan reviewed" --json
```

`gate check` is step-aware: it blocks file edits outside the active run scope and blocks edits during non-edit steps. Every start, transition, cancellation, checkpoint, and gate denial appends an event to `.contextpilot/orchestration/events.jsonl`.

## Agent workflow

After `contextpilot setup`, generated agent files contain the ContextPilot Protocol. The agent should:

1. Run `context --inject` at session start.
2. Start an orchestration run for coding tasks when none is active.
3. Plan, implement, review, verify, and checkpoint through `orchestrate`.
4. Record durable mistakes or constraints with `learn`.
5. Open a `decision` only when a real product/business answer is needed from the user.
6. Run `checkpoint` at the end of a task.

The user should not need to know these commands during normal use.

## Agent/API Reference

| Command | Agent-auto | Writes | Description |
|---------|------------|--------|-------------|
| `setup` | **Human once** | Yes | One-time project setup, then users chat normally |
| `doctor` | Human / CI | No | Check local harness installation and project setup |
| `status` | Yes | No | Drift / external / pending / **inDiscussion** |
| `list` | Yes | No | List rules and learnings |
| `knowledge query` | Yes | No | Find knowledge by text, file, scope, or target |
| `knowledge relevant` | Yes | No | Find knowledge relevant to file path(s) |
| `knowledge show` | Yes | No | Show one knowledge item by id |
| `learn` | Yes | Append | Record one learning (no sync) |
| `focus` | Yes | Yes | Update current focus (no sync) |
| `sync` | Yes | Yes | Regenerate agent targets |
| `checkpoint` | Yes | Yes | Session stop: sync + learn nudge |
| `context --inject` | Yes | No | Session start context for hooks |
| `refresh` | Yes (`--auto`) | Yes | Adopt external + handle drift |
| `watch` | Yes | Yes | Background sync; revert on gated edits |
| `orchestrate start` | Yes | Append | Start a prescriptive workflow run |
| `orchestrate status` | Yes | No | Show active run and current step |
| `orchestrate advance` | Yes | Append | Complete/block/fail current step |
| `orchestrate cancel` | Yes | Append | Cancel active run |
| `orchestrate event` | Yes | Append | Append a trace event |
| `decision open` | Yes | Append | Open business discussion (no sync) |
| `decision list` | Yes | No | List decisions (`--open`) |
| `decision resolve` | Yes* | Yes | Resolve -> rule + sync |
| `decision reject` | Yes | Yes | Reject discussion + sync |
| `gate check` | Yes | No | Hook adapter (stdin) |
| `gate precommit` | Yes | No | Git pre-commit backstop |
| `gate install` | Yes | Yes | Install hooks + git backstop |
| `srs install` | Yes | Yes | Install bundled fullstack-to-srs skill for all configured agents |
| `srs ingest` | Yes | Yes | Ingest `docs/srs/` into knowledge |
| `discover` | **Human** | Yes | Import existing rules/skills |
| `add` | **Human** | Yes | Import a file/dir as rules |
| `resolve` | Yes | Yes | Archive a learning |
| `forget` | **Human** | Yes | Permanently delete a learning |
| `init` | **`--yes`** / Human | Yes | Initialize `.contextpilot/` |

\* `decision resolve` is agent-auto when `gate.confirmMode` is `"chat"`; otherwise may require human TTY.

## Quick start

```bash
npm install -g @async-nguyen/contextpilot
cd your-project
contextpilot setup
```

Then open your AI coding agent and describe the feature or fix you want. The agent-facing CLI remains available for automation and debugging, but normal users should not need it.

## Publish Status / Beta Limitations

`contextpilot` is a public beta. The CLI command is stable as `contextpilot`, but hook behavior depends on each agent's supported hook surface.

- Claude Code and Cursor have the strongest hook coverage.
- Codex hook support is best-effort and may rely on git backstops depending on platform/version.
- Copilot and Windsurf are primarily protected by generated instructions and git pre-commit backstops.
- Run `contextpilot doctor` after setup to verify generated files, hooks, git backstop, bundled SRS assets, and active orchestration state.

## Examples

### Headless learn + sync (for agents)

```bash
contextpilot learn \
  --category constraint \
  --severity med \
  --title "API errors must be typed" \
  --detail "Never empty catch; use instanceof Error" \
  --scope "src/**" \
  --json

contextpilot sync --json
```

### Discussion gate

```bash
contextpilot decision open \
  --question "Should refunds be partial or full-only?" \
  --scope "src/billing/**" \
  --json

contextpilot status --json   # inDiscussion: true

# After user answers in chat:
contextpilot decision resolve --id dec_abc --resolution "Partial refunds up to 90 days" --json
```

### Session hooks

```bash
contextpilot context --inject --json
contextpilot checkpoint --json
```

### Orchestration flow

```bash
contextpilot orchestrate start \
  --goal "Implement partial refunds" \
  --scope "src/billing/**" \
  --json

contextpilot context --inject --json
contextpilot orchestrate advance --status complete --note "Plan complete" --json
contextpilot orchestrate status --json
```

### Discover preview (headless readonly)

```bash
contextpilot discover --dry-run --json --no-input
```

### SRS ingest

```bash
contextpilot srs install
# Ask your AI agent to generate the SRS into docs/srs/
contextpilot srs ingest --path docs/srs --reingest --json
```

### Knowledge retrieval

```bash
contextpilot knowledge relevant --file src/auth/login.ts --json
contextpilot knowledge query --query "auth password policy" --target codex --json
contextpilot knowledge show srs-03-auth --json
```

### Refresh auto-adopt

```bash
contextpilot refresh --auto --json
```

## ContextPilot Protocol

Every generated agent file includes a **ContextPilot Protocol** section instructing the agent to:

1. Treat ContextPilot commands as agent-facing automation, not user-facing chores.
2. Run `contextpilot context --inject` (or `status --json`) at session start.
3. Start or follow **Active Orchestration** and advance it with `orchestrate advance`.
4. Run `contextpilot learn` when mistakes/constraints are found.
5. **Open a discussion** before changing business logic when uncertain (`decision open` -> chat -> `decision resolve`)
6. Run `contextpilot knowledge relevant --file "<path>" --json` or `contextpilot knowledge query --query "<topic>" --json` before relying on SRS/knowledge, then read the returned source files.
7. Run `contextpilot refresh --auto` when new external rules appear.
8. Run `contextpilot checkpoint` (or `sync`) at logical checkpoints.
9. Never ask the user to run CLI commands except human-gated commands (`forget`, `discover`, `add`).

## SRS integration

- **`srs install`**: Copies bundled `fullstack-to-srs` skill to `.contextpilot/skills/fullstack-to-srs` for all configured agents. When Claude is enabled, it also writes a Claude-native compatibility copy to `.claude/skills/fullstack-to-srs`.
- **`srs ingest`**: Reads `docs/srs/NN-*.md`, creates scoped knowledge rules, seeds learnings from appendix QA items, then syncs agent targets.
- **Knowledge rendering**: Claude/Codex-style single-file targets use `agentContext.knowledgeMode: "manifest"` by default, so generated files point to `.contextpilot/context/knowledge-index.md` instead of inlining large SRS bodies. Set `agentContext.knowledgeMode` to `"inline"` in `harness.config.json` to restore the old behavior.

Bundled skill source: `assets/skills/fullstack-to-srs/`.

## Limitations

- Agents may not always self-initiate `learn` - humans should seed learnings early.
- **Cursor revert window** - `afterFileEdit` reverts after the edit; git pre-commit is the hard boundary.
- **Codex / Copilot hooks** - best-effort or commit-only; verify hook APIs for your agent version.
- Cursor User Rules and Copilot global instructions live in app settings and **cannot be auto-detected**.
- Global agent paths may change between versions; override via `harness.config.json` -> `discover.paths`.
- Human-gated commands exit code `3` in headless mode (`--no-input` or non-TTY), except `init --yes` and `decision resolve` with `confirmMode: "chat"`.
- `init` without `--yes` in headless mode exits code `2` with a hint.
- Hooks use `npx --no-install contextpilot` - global or project-local install required.
- No backup/undo (e.g. git branch) for drift adopt.
- Cannot enforce `learn` programmatically - protocol-only.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error / status issues (includes `inDiscussion`) |
| 2 | Missing required flag (e.g. headless `init` without `--yes`) |
| 3 | Requires human interaction |
| 4 | Unresolved drift (interactive sync) |

## Development

```bash
npm install
npm run build
node dist/index.js --help
```
