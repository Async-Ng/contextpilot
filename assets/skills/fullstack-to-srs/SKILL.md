---
name: fullstack-to-srs
description: Reconstruct a full IEEE 830-style business SRS from fullstack source evidence for any language or framework. Use when the user asks to read frontend/backend code and produce complete requirements, business rules, complete per-module use cases and user stories with coverage validation (not samples), automatically orchestrates section specialist subagents and per-section QA validators, writes SRS sections to docs/srs/ by default, acceptance criteria, and unresolved items marked with [CONFIRMATION REQUIRED].
---

# Fullstack To SRS

## Purpose

Use this skill to convert fullstack source evidence into a complete business-language SRS.

This skill is language-agnostic and framework-agnostic:

- Works with any client stack (web/mobile/desktop).
- Works with any server stack (API/services/jobs/events).
- Avoids implementation details in final SRS output.

Default output language is English unless the user explicitly asks otherwise.

**On invocation, act as Orchestrator.** Read [orchestration.md](orchestration.md), [section-agents.md](section-agents.md), and [output-layout.md](output-layout.md) immediately. Dispatch section specialist subagents and per-section QA validators by default per project size tier. Do not explore or write the full SRS alone on Normal/Large projects.

When populating Section 8 (Use Cases / User Stories), read [reference.md](reference.md) for detailed UC/US templates, examples, and anti-patterns.

## Output Delivery (docs/)

**Persist all SRS artifacts to disk** — chat output is a summary only; full content lives in section files.

### Output path resolution

| User instruction | Resolved path |
|------------------|---------------|
| (not specified) | `{projectRoot}/docs/srs/` |
| `output: docs/ba/` or `ghi vào docs/ba/` | `{projectRoot}/docs/ba/` |
| `output path: documentation/requirements` | `{projectRoot}/documentation/requirements/` |

Parse override **once** at skill start. Pass resolved path to all subagents.

### File layout (split by section and module)

| File | SRS section |
|------|-------------|
| `README.md` | TOC, phase status, coverage counts, links to all sections |
| `01-introduction.md` | Section 1 |
| `02-overall-description.md` | Section 2 |
| `03-functional-requirements/README.md` + `module-[slug].md` | Section 3, split per module |
| `04-non-functional-requirements.md` | Section 4 |
| `05-external-interface-requirements.md` | Section 5 |
| `06-data-requirements/README.md` + `module-[slug].md` | Section 6, split per module |
| `07-business-rules/README.md` + `module-[slug].md` | Section 7, split per module |
| `08-use-cases-user-stories/README.md` + `module-[slug].md` | Section 8, split per module |
| `09-error-handling.md` | Section 9 |
| `10-security-requirements.md` | Section 10 |
| `11-acceptance-criteria.md` | Section 11 |
| `12-appendix.md` | Section 12 (A–D) |

Create the output directory if missing. See [output-layout.md](output-layout.md) for README templates, module filename rules, and phase write schedule.

### Phase write schedule

| Phase | Files written/updated |
|-------|----------------------|
| **Phase 1** | `README.md`, `01-introduction.md`, `02-overall-description.md`, section README indexes for `03`, `06`, `07`, `08`, initialize `12-appendix.md` |
| **Phase 2** (per module) | Write/update module files under `03`, `06`, `07`, `08`; update section README indexes; update `12-appendix.md` traceability |
| **Phase 3** | Complete `04`, `09`, `10`, `11`, `12`; set `README.md` status = complete |

Do not mark a phase complete until affected files are persisted. Report written file paths to the user at each phase handoff.

## Non-Negotiable Output Rules

- Write requirements with this syntax: `The system shall <behavior> [under <condition>] [within <constraint>].`
- Keep each requirement atomic, observable, and testable.
- Use business terms seen by users (UI labels, screen titles, role names, workflow wording).
- If certainty is missing or conflicting, keep the statement and append `[CONFIRMATION REQUIRED]` exactly.
- Never invent facts not supported by provided evidence.
- Keep one canonical term per concept across the whole document.

## Prohibited in Final SRS

- No file names, class names, function names, component names, hooks, stores, package names.
- No stack-specific implementation text (framework internals, decorators, middleware mechanics).
- No technical field names without business meaning (for example: internal flags, internal timestamps).
- No source-trace columns such as "inferred from code", "technical notes", "source of inference".
- No code-style phrasing such as "service checks", "guard denies", "component renders".

## Evidence Priority

Use this order when evidence conflicts:

1. Explicit user instructions and domain glossary.
2. Runtime behavior and executable tests (if available).
3. Server-side business logic and policy checks.
4. Data contracts/schemas and validation contracts.
5. Client-side screens, labels, and interaction flows.
6. User-provided documents (PRD, SOP, policy, notes) as contextual evidence only.
7. Docs/comments only when nothing stronger exists.

When unresolved, keep `[CONFIRMATION REQUIRED]`.

## Evidence Hierarchy and Confidence

- Treat code behavior as the primary source of truth for system behavior.
- Treat user-provided business documents as secondary context that can clarify intent.
- User-provided business documents are never authoritative against code evidence; any mismatch stays unresolved until explicitly confirmed.
- Assign one confidence tier to every non-trivial inferred statement:
  - `Confirmed`: code evidence is explicit and consistent.
  - `Likely`: evidence is strong but indirect.
  - `Unverified`: evidence is partial or conflicting, must carry `[CONFIRMATION REQUIRED]`.

## Document vs Code Conflict Protocol

Apply this protocol whenever user-provided documents are present:

1. Compare each document claim against observable code behavior.
2. If there is any mismatch, even minor wording or threshold differences, open a conflict entry.
3. Do not silently reconcile conflicting claims.
4. Do not choose a winner autonomously when conflict remains unresolved.
5. Surface the conflict in output with `[CONFIRMATION REQUIRED]` and request explicit confirmation.

Mandatory output behavior for conflicts:

- In final SRS, keep requirement text conservative and business-readable.
- Append `[CONFIRMATION REQUIRED]` to every requirement impacted by unresolved doc-vs-code mismatch.
- Add the mismatch to the consolidated confirmation list in Appendix.
- Do not infer or synthesize a reconciled final rule for any unresolved mismatch.

## How To Read Client Side

- Start with navigation/sitemap to map full scope of business capabilities.
- Identify screens, forms, tables, dialogs, and user actions.
- Extract user-visible terms from labels/placeholders/messages/badges/tooltips.
- Capture validation behavior shown to users (required, ranges, patterns, cross-field checks).
- Capture lifecycle/status wording from badges and transitions.
- Capture permission behavior from visibility/disabled/action blocking on UI.
- Capture success/empty/error/confirmation messages as business evidence.

Translate findings into business statements, not implementation explanations.

## How To Read Server Side

- Start at all entry points (API/RPC/events/jobs/workflows).
- Trace flow: input -> auth/authz -> validation -> business rules -> persistence -> side effects -> output.
- Extract hidden business rules from conditional branching and rejection conditions.
- Extract data entities, relationships, and lifecycle states from domain models.
- Extract ownership/role constraints from policy checks.
- Extract data validation rules from input contracts and schema constraints.

Translate findings into policy and behavior that stakeholders can validate.

## Evidence Coverage Modes

This skill must work with partial evidence and must not require both client and server sources.

- `FE-only mode`:
  - Build SRS from client-side evidence (navigation, labels, forms, messages, visible flows).
  - Mark backend-dependent rules, server-side validations, or enforcement details as `[CONFIRMATION REQUIRED]`.
- `BE-only mode`:
  - Build SRS from server-side evidence (domain rules, states, validations, permissions, side effects).
  - Mark user-facing wording, screen flows, and UI interaction expectations as `[CONFIRMATION REQUIRED]`.
- `Fullstack mode`:
  - Reconcile client and server evidence using `Evidence Priority` and `Document vs Code Conflict Protocol`.

## Use Case & User Story Completeness Rules

These rules are mandatory. Partial or sample UC/US output is a failure.

- Every evidenced business capability (screen, user action with side effect, API/RPC/event/job entry point) must have at least one `UC-xxx` and at least one `US-xxx`.
- Do not summarize multiple capabilities into one UC/US (for example: "manage users", "handle orders", "similar cases", "etc.").
- Each capability gets its own `Cap-ID`, `UC-ID`, and `US-ID`.
- Use specific action-level naming: create, view, edit, delete, approve, reject, export, assign — not umbrella verbs.
- Every observable actor × goal combination must be covered. If evidence is missing, still list the capability in inventory and mark `[CONFIRMATION REQUIRED]`.
- Per module/phase minimum coverage:
  - `count(UC) >= count(capabilities_in_scope)`
  - `count(US) >= count(UC)`
- Every UC must include a numbered Main Flow and Alternate Flows for each observable rejection, validation, or permission branch.
- Every US must follow As a / I want / So that format with at least one acceptance criterion.
- Do not stop at a summary table. Section 8 must include inventory (8.1), detailed UC cards (8.2), and full user stories (8.3).

### Anti-Patterns (Never Do This)

- "Representative use cases" or "sample flows"
- "Other similar use cases follow the same pattern"
- A single UC covering create + edit + delete
- Section 8 with only a summary table and no detailed cards
- Placeholder rows with `...` or `TBD`
- Ending Phase 2 before all capabilities in the current module are mapped

See [reference.md](reference.md) for full anti-pattern list and correct examples.

## Capability Discovery & Inventory Protocol

Complete capability inventory **before** writing detailed UC/US. Do not write Section 8.2 or 8.3 until inventory is done.

### Evidence Sources → Capabilities

| Evidence Source | Extract As |
|-----------------|------------|
| Navigation / routing / sitemap | One or more capabilities per route/screen |
| Buttons, forms, dialogs, tables | One capability per user action with business side effect |
| API / RPC / event / job entry points | One capability per business operation |
| Role / permission checks | Actor variants for the same capability |
| Status transitions / workflows | Alternate flows within the related UC |

### Mandatory Inventory Table (per module)

Build this internally first; include a business-facing version in Section 8.1 or Appendix D.

| Cap-ID | Business Capability | Primary Actor | Related FR | UC-ID | US-ID | Evidence Confidence |
|--------|---------------------|---------------|------------|-------|-------|---------------------|
| CAP-M01-001 | ... | ... | FR-xxx | UC-xxx | US-xxx | Confirmed / Likely / Unverified |

Rules:

- `Cap-ID` format: `CAP-{ModuleCode}-{nnn}` (for example `CAP-AUTH-001`).
- Every row must eventually have `UC-ID` and `US-ID` before the module phase ends.
- Gaps stay in inventory with `[CONFIRMATION REQUIRED]` — never omit unverified capabilities.

### Traceability Mapping

Maintain FR ↔ UC ↔ US linkage:

| FR-ID | UC-ID | US-ID | Module | Coverage Status |
|-------|-------|-------|--------|-----------------|
| FR-001 | UC-001 | US-001 | Auth | Complete |

`Coverage Status` values: `Complete`, `Partial [CONFIRMATION REQUIRED]`, `Missing`.

Include the consolidated matrix in Section 8.4 or Appendix D.

## Synthesis Before Writing SRS

Build an internal reconciliation table first (do not include raw technical details in final SRS):

| Capability | Client Evidence | Server Evidence | Canonical Business Term |
|------------|-----------------|-----------------|-------------------------|
| ...        | ...             | ...             | ...                     |

Build a conflict register in parallel (internal only):

| Document Claim | Code Evidence | Conflict Description | Business Impact | Required Confirmation |
|----------------|---------------|----------------------|-----------------|-----------------------|
| ...            | ...           | ...                  | ...             | ...                   |

Synthesis rules:

- Business term naming: prefer user-visible labels and role names.
- Business rules: prefer server-side enforcement logic.
- User flow: prefer client journey and interaction order.
- Validation: merge client UX validation and server source-of-truth validation.
- Authorization: combine UI behavior and server enforcement.
- UC/US inventory: derive from merged capability list, not from a subjective "most important" subset.

## Large Project Workflow

Work phased by module. **Orchestrator dispatches section specialists and Section QA per [orchestration.md](orchestration.md) and [section-agents.md](section-agents.md).** Run Write → Validate → Log for each section. Section QA FAIL does not block the next module — log gaps in Appendix B and continue.

### Phase 1 - Skeleton

- **Evidence (parallel):** RepoMapper, FE_Scanner, BE_Scanner — see orchestration.md.
- **Writers (parallel):** Sec01_Specialist, Sec02_Specialist.
- **QA (parallel, readonly):** Sec01_QA, Sec02_QA — log results to Appendix B.
- Input: repository structure + navigation/routing + list of major pages/surfaces.
- Output:
  - Sections 1, 2
  - **Module Map** (all business modules/domains)
  - **Evidence Ledger** draft
  - **High-level Capability Inventory** across all modules
  - Expected UC/US count per module
  - Initial `[CONFIRMATION REQUIRED]` list
  - **Persist:** `README.md`, `01-introduction.md`, `02-overall-description.md`, section README indexes for `03`, `06`, `07`, `08`, initialize `12-appendix.md` with Appendix B QA template

### Phase 2 - Domain Deep Dive (one module at a time)

- **Evidence (parallel):** FE_Module + BE_Module → merge module Capability Inventory.
- **Writers (parallel):** Sec03_Specialist, Sec06_Specialist, Sec07_Specialist, Sec08_Specialist.
- **QA (parallel, readonly):** Sec03_QA, Sec06_QA, Sec07_QA, Sec08_QA — log to Appendix B; optional GapFill for missing Cap-IDs from Sec08_QA.
- Input: one domain slice at a time (client screens + server logic + domain models).
- Output for the **current module only**:
  - Detailed FR, data requirements, business rules
  - **Complete Capability Inventory** for the module (Section 8.1)
  - **All use cases** with main + alternate flows (Section 8.2)
  - **All user stories** with acceptance criteria (Section 8.3)
  - Traceability matrix rows for the module (Section 8.4)
- Run Module Completion Checklist; ensure Sec08_QA has run and result is logged before starting the next module.
- **Persist:** write/update the current module files under `03-functional-requirements/`, `06-data-requirements/`, `07-business-rules/`, and `08-use-cases-user-stories/`; update each section README index; update `12-appendix.md`

### Phase 3 - Finalization

- **Writers (parallel):** Sec04, Sec05, Sec09, Sec10, Sec11_Specialist.
- **QA (parallel, readonly):** Sec04_QA through Sec11_QA.
- **Finalize:** Sec12_Merger, Sec12_QA, FinalQA.
- Input: cross-cutting concerns (auth/security/error handling/NFR) + accumulated SRS drafts + Section QA log.
- Output:
  - Completed 12-section SRS
  - **Cross-Module UC/US Index**
  - Consolidated coverage summary (total Cap / UC / US per module)
  - Section QA Summary in Appendix B
  - Acceptance criteria and consolidated open confirmations
  - **Persist:** complete `04`, `05`, `09`, `10`, `11`, `12`; update `README.md` status = complete

### Module Completion Checklist

Do not mark a module phase complete until all items pass:

- [ ] Orchestrator dispatched tier-appropriate subagents (not single-agent on Normal/Large)
- [ ] Capability inventory covers all routes/screens/API entry points for the module
- [ ] Every `Cap-ID` has a `UC-ID` and `US-ID` (or explicit `[CONFIRMATION REQUIRED]` with reason)
- [ ] `count(UC) >= count(capabilities_in_scope)` for the module
- [ ] `count(US) >= count(UC)` for the module
- [ ] Every UC has numbered Main Flow and Alternate Flows for observable branches
- [ ] Section 8.2 has detailed UC cards, not only the summary table
- [ ] Section 8.3 has full user stories (As a / I want / So that + AC)
- [ ] No placeholder `...`, `TBD`, or "similar cases" wording
- [ ] Traceability matrix updated for the module
- [ ] **Sec08_QA has run** for the module; result logged in Appendix B (GapFill completed for missing Cap-IDs if applicable)
- [ ] Appendix lists `[CONFIRMATION REQUIRED]` items for capabilities with missing evidence
- [ ] **Module files for the current module persisted to resolved docs output path**

## Automatic Subagent Orchestration (Default)

Subagent orchestration is **mandatory by default** for Normal and Large projects. User does not need to request subagents explicitly.

| Tier | Condition | Strategy |
|------|-----------|----------|
| **Trivial** | <= 1 module AND <= 5 capabilities | Single-agent fast path allowed |
| **Normal** | 2–5 modules OR 6–30 capabilities | Subagents mandatory for Phase 2 per module |
| **Large** | > 5 modules OR > 30 capabilities | Subagents mandatory for all phases |

When uncertain, assume **Normal**.

**Orchestrator role (parent agent):** plan phases, dispatch Task subagents, merge artifacts, run gates, deliver. Do not substitute solo exploration or solo UC/US writing on Normal/Large projects.

Full playbook, section specialist definitions, prompt templates, merge/retry protocol: [orchestration.md](orchestration.md), [section-agents.md](section-agents.md).

### Phase Subagent Map (summary)

| Phase | Parallel subagents |
|-------|-------------------|
| Phase 1 Evidence | RepoMapper, FE_Scanner, BE_Scanner (`explore`) |
| Phase 1 Write | Sec01_Specialist, Sec02_Specialist (`generalPurpose`) |
| Phase 1 QA | Sec01_QA, Sec02_QA (`generalPurpose`, readonly) |
| Phase 2 Evidence | FE_Module, BE_Module (`explore`) |
| Phase 2 Write | Sec03, Sec06, Sec07, Sec08_Specialist (`generalPurpose`) |
| Phase 2 QA | Sec03_QA, Sec06_QA, Sec07_QA, Sec08_QA (`generalPurpose`, readonly); GapFill on missing Cap-IDs |
| Phase 3 Write | Sec04, Sec05, Sec09, Sec10, Sec11_Specialist (`generalPurpose`) |
| Phase 3 QA + Final | Sec04–Sec11_QA, Sec12_Merger, Sec12_QA, FinalQA |

Merge policy:

- User explicit instruction wins.
- Then stronger evidence wins per `Evidence Priority`.
- If any document-vs-code conflict persists, do not resolve it by wording preference.
- Preserve `[CONFIRMATION REQUIRED]` for unresolved points.
- For document-vs-code conflicts, never auto-resolve; keep both sides traceable internally and mark affected outputs.
- Do not merge partial UC/US sets; union all capabilities and fill gaps before delivery.
- Union subagent artifacts; run Section QA (Write → Validate → Log) before phase handoff.
- Section QA WARN/FAIL does not block — log in Appendix B and patch `[CONFIRMATION REQUIRED]`.

## Output Contract (12 Sections)

Produce all sections below in order:

1. Introduction
2. Overall Description
3. Functional Requirements
4. Non-functional Requirements
5. External Interface Requirements
6. Data Requirements
7. Business Rules
8. Use Cases / User Stories (8.1 Inventory, 8.2 Detailed UC, 8.3 User Stories, 8.4 Traceability)
9. Error Handling
10. Security Requirements
11. Acceptance Criteria
12. Appendix

Hard requirements:

- Functional statements use `The system shall ...`.
- Keep IDs consistent: `FR`, `NFR`, `BR`, `UC`, `US`, `ERR`, `AC`, `CAP`.
- Mark every unresolved item with `[CONFIRMATION REQUIRED]`.
- Keep language purely business-facing.
- Section 8 must be complete for the current module — not a sample subset.
- If any user document statement conflicts with code evidence, mark impacted requirements `[CONFIRMATION REQUIRED]` and list the conflict in Appendix.
- Support FE-only and BE-only inputs without blocking generation.

## Reusable SRS Template

Use this template for the final answer. For Section 8 detail structure, see [reference.md](reference.md).

```markdown
# SOFTWARE REQUIREMENTS SPECIFICATION (SRS)
# [System Name]

| Field | Content |
|-------|---------|
| Version | 1.0.0 |
| Date | [YYYY-MM-DD] |
| Status | Draft - Reconstructed from source code |

> This document is reconstructed from fullstack source code evidence.
> Items marked with **[CONFIRMATION REQUIRED]** require Product Owner confirmation.

## TABLE OF CONTENTS
1. Introduction
2. Overall Description
3. Functional Requirements
4. Non-functional Requirements
5. External Interface Requirements
6. Data Requirements
7. Business Rules
8. Use Cases / User Stories
9. Error Handling
10. Security Requirements
11. Acceptance Criteria
12. Appendix

## 1. INTRODUCTION
### 1.1 Purpose
[Document purpose and audiences]

### 1.2 Scope
[Business problem, users, outcomes, in-scope and out-of-scope]
[CONFIRMATION REQUIRED] for uncertain boundaries.

### 1.3 Definitions
| Term | Definition |
|------|------------|
| ... | ... |

### 1.4 References
| # | Reference |
|---|-----------|
| 1 | Reconstructed system behavior evidence (internal trace retained outside final SRS) |
| 2 | Reconstructed business rule evidence (internal trace retained outside final SRS) |
| 3 | User-provided business documents (supporting context, not authoritative) [CONFIRMATION REQUIRED] |
| 4 | IEEE 830 |

## 2. OVERALL DESCRIPTION
### 2.1 Product Perspective
### 2.2 Product Functions
### 2.3 User Classes
### 2.4 Operating Environment
### 2.5 Constraints
### 2.6 Assumptions

## 3. FUNCTIONAL REQUIREMENTS
| ID | Requirement |
|----|-------------|
| FR-001 | The system shall ... |
| FR-002 | The system shall ... |

[Provide detailed FR cards for critical requirements]

## 4. NON-FUNCTIONAL REQUIREMENTS
| ID | Requirement |
|----|-------------|
| NFR-001 | The system shall ... |

## 5. EXTERNAL INTERFACE REQUIREMENTS
### 5.1 User Interface
### 5.2 External Business Service Interactions (consumer-visible only; no endpoint names or protocol internals)
### 5.3 System-to-System Interactions (business purpose, trigger, and outcome only)
### 5.4 Physical Channel Constraints (only if user-observable or policy-relevant)

## 6. DATA REQUIREMENTS
### 6.1 Business Data Model
### 6.2 Relationships
### 6.3 Lifecycle States
### 6.4 Validation Rules

## 7. BUSINESS RULES
| ID | Rule | Violation Outcome |
|----|------|-------------------|
| BR-001 | The system shall ... | ... |

## 8. USE CASES / USER STORIES

### 8.1 Capability & Use Case Inventory (Module: [ModuleName])
| Cap-ID | UC-ID | Name | Actor | Goal Summary | US-ID | Confidence |
|--------|-------|------|-------|--------------|-------|------------|
| CAP-xxx-001 | UC-001 | ... | ... | ... | US-001 | Confirmed |

[List every capability for the module — no omissions]

### 8.2 Detailed Use Cases

#### UC-001: [Use Case Name]
- **Actor:** ...
- **Goal:** ...
- **Preconditions:** ...
- **Postconditions:** ...
- **Related FR:** FR-xxx | **Related BR:** BR-xxx

**Main Flow:**
1. ...
2. ...

**Alternate Flows:**
- **AF-001-a:** [Condition] → ...
- **AF-001-b:** [Validation failure] → ...

**Exception Flows:**
- **EF-001-a:** [Scenario] → see ERR-xxx

[Repeat for every UC in 8.1]

### 8.3 User Stories

#### US-001: [Story Title]
**As a** [role]
**I want** [goal in business terms]
**So that** [business value]

**Related UC:** UC-001

**Acceptance Criteria:**
- [ ] AC-US-001-01: Given ... When ... Then ...
- [ ] AC-US-001-02: Given ... When ... Then ...

[Repeat for every US in 8.1 — at least one per UC]

### 8.4 Traceability Matrix (Module: [ModuleName])
| FR-ID | UC-ID | US-ID | Module | Coverage Status |
|-------|-------|-------|--------|-----------------|
| FR-001 | UC-001 | US-001 | ... | Complete |

## 9. ERROR HANDLING
| ID | Scenario | User-Facing Message | Expected Behavior |
|----|----------|---------------------|-------------------|
| ERR-001 | ... | ... | The system shall ... |

## 10. SECURITY REQUIREMENTS
- The system shall enforce authentication for protected capabilities.
- The system shall enforce role/permission restrictions by business policy.
- The system shall protect sensitive data in transit and at rest. [CONFIRMATION REQUIRED]
- Security requirements shall describe policy outcomes and business impact, not internal mechanisms or infrastructure details.

## 11. ACCEPTANCE CRITERIA
[For critical FRs]
- [ ] AC-001-01: When [condition], the system shall [observable outcome].
- [ ] AC-001-02: When [condition], the system shall [observable outcome].

## 12. APPENDIX
### A. ID Reference
### B. Consolidated [CONFIRMATION REQUIRED] List
### C. Revision History
### D. Cross-Module UC/US Index & Coverage Summary
| Module | Capabilities | Use Cases | User Stories | Open [CONFIRMATION REQUIRED] |
|--------|--------------|-----------|--------------|---------------------|
| ... | ... | ... | ... | ... |
```

## Final Validation Gate

Before returning final SRS (or completing a module phase), verify:

- All 12 sections exist in correct order.
- **All phase subagents completed for current tier; merge artifacts verified.**
- Requirement statements are atomic and testable.
- No technical identifiers leaked into business text.
- Terminology is consistent end-to-end.
- Unresolved points preserve `[CONFIRMATION REQUIRED]` exactly.
- No framework/language lock-in unless user explicitly requests it.
- Every unresolved document-vs-code mismatch is explicitly listed as `[CONFIRMATION REQUIRED]`.
- No unresolved conflict is auto-decided by the agent.
- SRS can still be produced with FE-only or BE-only evidence; missing counterpart evidence is explicitly marked `[CONFIRMATION REQUIRED]`.

### UC/US Coverage Validation (mandatory)

- **FinalQA subagent returned PASS** (or gaps explicitly listed in Appendix B with `[CONFIRMATION REQUIRED]`).
- **Every section written in the current phase has a Section QA report** logged in Appendix B.
- Section 8 includes **8.1 + 8.2 + 8.3** (summary table alone is insufficient).
- `count(UC) >= count(capabilities_in_scope)` for the current module, or every gap is in inventory with `[CONFIRMATION REQUIRED]`.
- `count(US) >= count(UC)`.
- Every UC has a numbered Main Flow.
- Every UC has Alternate Flows for each observable rejection, validation, and permission branch.
- No umbrella UC/US ("manage X", "handle Y") — actions are split (create, view, edit, delete, approve, etc.).
- No anti-patterns from [reference.md](reference.md).
- Traceability matrix (8.4 or Appendix D) has no `Missing` rows without `[CONFIRMATION REQUIRED]` explanation.
- Module Completion Checklist is fully satisfied before phase handoff.

### Docs Output Validation (mandatory)

- All section files and module files exist at the resolved output path for the current phase scope.
- Root `README.md` contains valid TOC links to every global section file and split section README.
- Split section README indexes link to every module file.
- Chat response lists written file paths; full SRS content is on disk, not chat-only.
- Section 8 module files are updated per module (not combined) unless GapFill targets a specific module.
