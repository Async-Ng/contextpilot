# Zero-touch smoke fixture

Manual smoke for v0.2 `init --yes` flow. From repo root after `npm run build`:

```bash
cd fixtures/zero-touch
git init
node ../../dist/index.js init --yes --no-input --json
node ../../dist/index.js decision open --question "Smoke test?" --scope "**" --json
node ../../dist/index.js status --json    # expect inDiscussion: true, exit 1
node ../../dist/index.js context --inject --json
node ../../dist/index.js checkpoint --json
echo '{"command":"echo hi"}' | node ../../dist/index.js gate check --agent cursor  # expect deny, exit 2
```

Clean up `.harness/`, `.git/`, and agent hook files between runs.
