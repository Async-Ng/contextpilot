# Fullstack To SRS - Output Layout

Read this file when the skill is invoked, alongside [orchestration.md](orchestration.md) and [section-agents.md](section-agents.md).

## Default Output Path

`{projectRoot}/docs/srs/`

Create the directory if it does not exist.

## Path Override

Parse once at skill start from user instruction:

| User says | Resolved path |
|-----------|---------------|
| (nothing) | `{projectRoot}/docs/srs/` |
| `output: docs/ba/` | `{projectRoot}/docs/ba/` |
| `ghi vao docs/ba/` | `{projectRoot}/docs/ba/` |
| `output path: documentation/requirements` | `{projectRoot}/documentation/requirements/` |

Pass `Output path: [resolved]` to every subagent prompt.

## File Tree

Module-heavy sections are directories. Each directory has a lightweight `README.md` index plus one file per module.

```
docs/srs/
|-- README.md
|-- 01-introduction.md
|-- 02-overall-description.md
|-- 03-functional-requirements/
|   |-- README.md
|   `-- module-[module-slug].md
|-- 04-non-functional-requirements.md
|-- 05-external-interface-requirements.md
|-- 06-data-requirements/
|   |-- README.md
|   `-- module-[module-slug].md
|-- 07-business-rules/
|   |-- README.md
|   `-- module-[module-slug].md
|-- 08-use-cases-user-stories/
|   |-- README.md
|   `-- module-[module-slug].md
|-- 09-error-handling.md
|-- 10-security-requirements.md
|-- 11-acceptance-criteria.md
`-- 12-appendix.md
```

Optional working file (Orchestrator may use internally or mirror in Appendix B):

```
docs/srs/qa-log.md   # optional mirror of Section QA Summary
```

## Module Filename Rule

For Sections 03, 06, 07, and 08, write one module file per business module:

`module-[slugified-module-name].md`

Examples:

| Module | File |
|--------|------|
| Auth | `module-auth.md` |
| Order Management | `module-order-management.md` |
| Refunds & Returns | `module-refunds-returns.md` |

Rules:

- A module file must contain exactly one business module.
- Do not combine multiple modules in one module file.
- If a module is renamed, keep the old file only if it is still linked from the section index as archived or superseded.
- Section folder `README.md` is an index only; it is not the authoritative module content.

## Root README.md Template

```markdown
# SRS Documentation Index

| Field | Value |
|-------|-------|
| System | [System Name] |
| Version | 1.0.0 |
| Generated | [YYYY-MM-DD] |
| Phase | [Skeleton / Module: X / Complete] |
| Output path | [resolved path] |

## Table of Contents

- [01 Introduction](01-introduction.md)
- [02 Overall Description](02-overall-description.md)
- [03 Functional Requirements](03-functional-requirements/README.md)
- [04 Non-functional Requirements](04-non-functional-requirements.md)
- [05 External Interface Requirements](05-external-interface-requirements.md)
- [06 Data Requirements](06-data-requirements/README.md)
- [07 Business Rules](07-business-rules/README.md)
- [08 Use Cases / User Stories](08-use-cases-user-stories/README.md)
- [09 Error Handling](09-error-handling.md)
- [10 Security Requirements](10-security-requirements.md)
- [11 Acceptance Criteria](11-acceptance-criteria.md)
- [12 Appendix](12-appendix.md)

## Coverage Summary

| Module | Capabilities | Use Cases | User Stories | Open [CONFIRMATION REQUIRED] |
|--------|--------------|-----------|--------------|------------------------------|
| ... | ... | ... | ... | ... |

## Section QA Summary

| Section | Status | WARN/FAIL Count |
|---------|--------|-----------------|
| 01 | PASS | 0 |
| ... | ... | ... |
```

## Section Folder README.md Template

Use this template for `03-functional-requirements/README.md`, `06-data-requirements/README.md`, `07-business-rules/README.md`, and `08-use-cases-user-stories/README.md`.

```markdown
# Section N: [Title]

> Index for module files. Authoritative module content lives in `module-*.md` files.

| Module | File | Items | QA Status | Open [CONFIRMATION REQUIRED] |
|--------|------|-------|-----------|------------------------------|
| Auth | [module-auth.md](module-auth.md) | FR: 12 | PASS | 0 |
| ... | ... | ... | ... | ... |
```

## Per-File Rules

Global section files start with:

```markdown
# Section N: [Title]

> Part of SRS for [System Name]. Items marked [CONFIRMATION REQUIRED] require Product Owner confirmation.
```

Module section files start with:

```markdown
# Section N: [Title] - Module: [ModuleName]

> Part of SRS for [System Name]. Items marked [CONFIRMATION REQUIRED] require Product Owner confirmation.
```

Write business-language content only. No source file names or code identifiers.

### Documenting a fully-removed module

If a module was completely removed from the codebase and the decision is to keep its SRS entry
as a historical record instead of deleting the file (for traceability - the same convention used
elsewhere for retired business rules), start the module's body with exactly this heading:

```markdown
## Module Removed
```

followed by a short explanation of why it was removed and what replaced it, if anything. This
exact heading is machine-recognized by `contextpilot srs ingest`: it tags the resulting rule as
`removed` and lowers its priority, instead of treating a now-dead scope glob as a mistake. Do not
reuse this heading for anything other than "this entire module no longer exists."

## Phase Write Schedule

| Phase | Action |
|-------|--------|
| Phase 1 | Create root README, 01, 02; create empty README indexes for 03/06/07/08; initialize 12 with module map and Appendix B QA template |
| Phase 2 (each module) | Write/update the current module file under 03, 06, 07, and 08; update each section README index; update 12 traceability; log Section QA rows |
| Phase 3 | Write 04, 05, 09, 10, 11; finalize 12 with QA Summary; README status = Complete |

## Section 8 Module File Protocol

Directory: `08-use-cases-user-stories/`

For each module in Phase 2, create or update:

`08-use-cases-user-stories/module-[module-slug].md`

Each module file contains:

```markdown
# Section 8: Use Cases / User Stories - Module: [ModuleName]

## 8.1 Capability and Use Case Inventory
...

## 8.2 Detailed Use Cases
...

## 8.3 User Stories
...

## 8.4 Traceability Matrix
...
```

Rules:

- Do not overwrite a module file that Sec08_QA returned PASS for unless GapFill targets specific Cap-IDs.
- GapFill may replace only the failed module file content or missing Cap-ID content.
- Do not start 8.2/8.3 content until inventory for that module is complete.

## Appendix B: Section QA Summary Template

Initialize in `12-appendix.md` during Phase 1. Append a row after each Section QA run.

```markdown
### B. Section QA Summary

| Section | Module | Status | Gaps | [CONFIRMATION REQUIRED] Items |
|---------|--------|--------|------|-------------------------------|
| 01 Introduction | all | PASS | - | - |
| 03 FR | Order | WARN | FR-012 no BE evidence | FR-012 |
| 08 UC/US | Auth | FAIL | Cap-007 missing UC | Cap-007 |
```

## QA FAIL Handling (Non-Blocking)

When Section QA returns WARN or FAIL:

1. Do not rollback the section or module file.
2. Orchestrator patches affected items with `[CONFIRMATION REQUIRED]` inline in the relevant file.
3. Append the QA row to Appendix B (and optional `qa-log.md`).
4. Continue to the next section or module.
5. FinalQA aggregates all Section QA entries and produces the final verdict.

## Write -> Validate -> Log

For every section/module written in the current phase:

1. Section Specialist writes or updates the section file or module file.
2. Matching Section QA (`readonly: true`) validates evidence and completeness.
3. Orchestrator logs result in Appendix B.
4. Orchestrator patches `[CONFIRMATION REQUIRED]` on flagged items.
5. Pipeline continues regardless of QA status.

See [section-agents.md](section-agents.md) for specialist playbooks and QA checklists.

## Chat vs Disk

- Disk: full SRS section and module content (authoritative).
- Chat: phase summary, coverage counts, Section QA WARN/FAIL counts, list of written file paths, open [CONFIRMATION REQUIRED] count.

Never mark a phase complete if files were not written.
