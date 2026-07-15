# v0.4.2 - Light profile defaults

ContextPilot `0.4.2` makes the default experience lighter for solo and small-team repos while
keeping strict/team behavior available through config.

## Highlights

- Default profile is now `light`
- Agent files now use a stub protocol and index-first global knowledge by default
- Small technical tasks no longer require orchestration by default
- `status`, `context --inject`, and `sync` auto-ingest safe SRS drift
- Hook infrastructure failures warn-open in light mode; real gate denials still block
- `sync --preview` reports generated-size deltas

## Upgrade notes

- No migration is required.
- Use `"profile": "strict"` in `.contextpilot/harness.config.json` to restore stricter team defaults.
- `orchestrate start` is unchanged when invoked directly.
