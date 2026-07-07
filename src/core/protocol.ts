/** ContextPilot Protocol: agent-facing automation contract. */
export const HARNESS_PROTOCOL = `## ContextPilot Protocol - invisible to the user, mandatory for you
- The human should be able to chat normally about product/features. Do not ask the human to run
  ContextPilot commands unless the command is explicitly human-gated. You run agent-safe ContextPilot
  commands yourself through the shell/tool interface.
- User Interaction Rule: ask the human only product, business, requirement, or approval questions.
  Do not expose orchestration, memory, sync, gate, or checkpoint mechanics unless they ask.
- At session start: run \`contextpilot context --inject\` (or \`contextpilot status --json\`),
  then read the "Active Orchestration", "Learned Constraints", "Current Focus", and any
  "Open Decisions" sections in this file.
- If ContextPilot is not initialized and the user asks you to work in this repo, run
  \`contextpilot setup --json\`, then continue. Do not ask the user to initialize it.
- If the user asks for a coding task and there is no Active Orchestration, start one yourself:
  \`contextpilot orchestrate start --goal "<user request summary>" --scope "<best affected glob>" --json\`.
  Infer the narrowest useful scope from the repo; if unsure, use the smallest obvious project area
  and refine your plan before editing.
- If "Active Orchestration" is present, follow the current step role/instructions and advance
  the workflow with \`contextpilot orchestrate advance --status complete --note "<evidence>" --json\`
  when the step is done. Do not edit files during non-edit orchestration steps.
- When you make a mistake and fix it, OR discover a non-obvious system constraint,
  immediately record it:
  \`contextpilot learn --category <mistake|constraint|gotcha|decision> --severity <low|med|high> --title "<short>" --detail "<what and why>" --scope "<glob>" --json\`
- Business-logic discussion gate (MANDATORY): Before changing business logic in scoped
  files, if you are uncertain about requirements, trade-offs, or user intent, you MUST NOT guess.
  Instead:
  1. Run \`contextpilot decision open --question "<your question>" --detail "<context>" --scope "<glob>" --json\`
  2. Ask the user the product/business question in chat and wait for their answer
  3. After the user answers, run \`contextpilot decision resolve --id <id> --resolution "<decision>" --json\`
  4. Only then proceed with code changes in the affected scope
- If \`status --json\` reports new external rules or skills, run: \`contextpilot refresh --auto --json\`.
- Before relying on SRS, requirements, or imported project knowledge, run
  \`contextpilot knowledge relevant --file "<path>" --task code --limit 2 --json\` for file-scoped work or
  \`contextpilot knowledge query --query "<topic>" --json\` for topic search.
- Agent files contain SRS summaries only. Never assume full SRS text is in context.
- Load full body only via \`contextpilot knowledge show <id>\` for the returned ids (max 1-2 per task).
- Do NOT Read docs/srs or .contextpilot/rules directly unless editing SRS sources or srsDrift is set.
- Cursor: if scoped .mdc rules already match the edited path, skip re-reading the same SRS body.
- If status or the agent file reports "SRS Bootstrap Required", run
  \`contextpilot srs bootstrap --json\`, read \`.contextpilot/skills/fullstack-to-srs/SKILL.md\`,
  write the initial SRS under \`docs/srs/\`, then run
  \`contextpilot srs ingest --path docs/srs --reingest --json\` before feature/business coding.
- If the user asks for an SRS, run \`contextpilot srs install --json\` if needed, read
  \`.contextpilot/skills/fullstack-to-srs/SKILL.md\`, follow that skill, write the SRS to
  \`docs/srs/\`, then run \`contextpilot srs ingest --path docs/srs --reingest --json\`.
- Whenever you edit any file under the ingested SRS path (not only when writing a brand-new
  SRS), immediately run \`contextpilot srs ingest --path <path> --reingest --json\` before
  finishing the task. \`status --json\` and \`context --inject\` list stale/never-ingested SRS
  files under "srsDrift" if you forget - treat any non-empty "srsDrift" as a required-before-done
  item, not an FYI.
- At the end of a task or a logical checkpoint, run: \`contextpilot checkpoint --json\`
  (or \`contextpilot sync --json\`). If you have an Active Orchestration run and its current step
  is the final "checkpoint" step, running \`checkpoint\` also completes that step and the run
  automatically - you do not need a separate \`orchestrate advance\` call in that case. If the run
  is at an earlier step, \`checkpoint\` will not advance it and the output will say so; call
  \`orchestrate advance\` for that step once it is actually done.
- Do NOT run \`contextpilot forget\`, \`discover\`, \`add\`, or pass \`--force\`. Those need a
  human. Ask the user only when one of those commands is truly required.`;
