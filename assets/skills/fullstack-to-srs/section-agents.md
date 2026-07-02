# Fullstack To SRS - Section Specialist Agents

Read this file **immediately** when the skill is invoked, alongside [orchestration.md](orchestration.md) and [output-layout.md](output-layout.md).

Each SRS section file has a **dedicated Specialist Writer** and a **dedicated QA Validator**. The Orchestrator runs **Write → Validate → Log** for every section touched in the current phase.

## Architecture (3 Layers)

```
Evidence Layer (explore)  →  Section Specialists (generalPurpose)  →  Section QA (generalPurpose, readonly)
```

| Layer | Agents | Purpose |
|-------|--------|---------|
| Evidence | RepoMapper, FE_Scanner, BE_Scanner, FE_Module, BE_Module | Gather code/doc evidence; build Capability Inventory |
| Specialists | Sec01_Specialist … Sec12_Merger | Deep analysis; write one section file or one module file |
| Validators | Sec01_QA … Sec12_QA, FinalQA | Evidence audit, fabrication check, completeness check |

## QA Policy (Non-Blocking)

When a Section QA returns **WARN** or **FAIL**:

1. Orchestrator logs the result in Appendix B (Section QA Summary).
2. Orchestrator patches affected items with `[CONFIRMATION REQUIRED]` inline in the section file.
3. **Do not block** the pipeline — continue to the next section or module.
4. **FinalQA** aggregates all section QA reports and produces the final coverage summary.

Optional **GapFill** only when Sec08_QA lists specific missing Cap-IDs (scoped retry, max 2 per module).

## Evidence Ledger

Orchestrator maintains an **Evidence Ledger** after Phase 1 evidence merge. Store in `12-appendix.md` section D or pass as artifact to all specialists/QA.

| Cap-ID | Module | FE Evidence | BE Evidence | Doc Evidence | Confidence |
|--------|--------|-------------|-------------|--------------|------------|
| CAP-AUTH-001 | Auth | Login screen, submit action | POST login handler, token issue | — | Confirmed |

Rules:

- Every FR, BR, UC, US, ERR, AC must trace to at least one Cap-ID or explicit cross-cutting evidence.
- Specialists **must not** invent capabilities absent from the ledger without marking `[CONFIRMATION REQUIRED]`.
- QA validators **must** flag any requirement with no ledger backing as fabrication risk.

## Section → Agent Mapping

| File | Specialist | QA Validator | Primary Evidence |
|------|------------|--------------|------------------|
| `01-introduction.md` | Sec01_Specialist | Sec01_QA | RepoMapper, user docs |
| `02-overall-description.md` | Sec02_Specialist | Sec02_QA | RepoMapper, FE/BE scanners |
| `03-functional-requirements/module-[module-slug].md` | Sec03_Specialist | Sec03_QA | FE_Module, BE_Module, Cap-IDs |
| `04-non-functional-requirements.md` | Sec04_Specialist | Sec04_QA | config, infra, scanners |
| `05-external-interface-requirements.md` | Sec05_Specialist | Sec05_QA | API routes, UI boundaries |
| `06-data-requirements/module-[module-slug].md` | Sec06_Specialist | Sec06_QA | schemas, models, BE_Module |
| `07-business-rules/module-[module-slug].md` | Sec07_Specialist | Sec07_QA | validations, guards, state rules |
| `08-use-cases-user-stories/module-[module-slug].md` | Sec08_Specialist | Sec08_QA | module inventory, FE+BE flows |
| `09-error-handling.md` | Sec09_Specialist | Sec09_QA | error handlers, API error shapes |
| `10-security-requirements.md` | Sec10_Specialist | Sec10_QA | auth, RBAC, middleware |
| `11-acceptance-criteria.md` | Sec11_Specialist | Sec11_QA | Sec08 US, FR cross-ref |
| `12-appendix.md` | Sec12_Merger | Sec12_QA | all section outputs + QA log |

### Deprecated Roles (do not dispatch)

| Old Role | Replaced By |
|----------|-------------|
| UC_Writer + US_Writer | Sec08_Specialist |
| FR_BR_Writer | Sec03_Specialist, Sec06_Specialist, Sec07_Specialist |
| CrossCutting | Sec04_Specialist, Sec09_Specialist, Sec10_Specialist |
| QA_Coverage | Sec08_QA (per module) + FinalQA |
| Merger | Sec12_Merger |

## QA Return Format (mandatory)

Every Section QA subagent must return:

```markdown
## Section QA Report
- Section: [NN]
- Module: [name or all]
- Status: PASS | WARN | FAIL
- Items reviewed: N
- Fabrication risks: N
- Completeness gaps: N

## Findings
| Item-ID | Issue Type | Description | Suggested Action |
|---------|------------|-------------|------------------|
| FR-012 | no_evidence | No BE or FE evidence in ledger | Mark [CONFIRMATION REQUIRED] |
| Cap-007 | missing_uc | Capability in inventory, no UC card | GapFill or [CONFIRMATION REQUIRED] |

## Open [CONFIRMATION REQUIRED]
- [list items to patch]

## Verdict Summary
[One paragraph: safe to proceed with warnings, or critical gaps logged]
```

Issue types: `no_evidence`, `fabrication_risk`, `missing_item`, `id_mismatch`, `technical_leakage`, `incomplete_flow`, `coverage_gap`, `terminology_drift`.

## Specialist Return Format (mandatory)

Every Section Specialist must return the standard subagent format from orchestration.md **plus**:

```markdown
## Section Written
- File: [output path + filename]
- IDs created: [FR-xxx, UC-xxx, ...]
- Cap-IDs covered: [list]
- Items marked [CONFIRMATION REQUIRED]: N
```

Specialists **persist content to disk** at the resolved output path unless Orchestrator explicitly handles persistence from artifacts.

---

## Sec01_Specialist — Introduction

**File:** `01-introduction.md`

**Evidence inputs:** RepoMapper Module Map, system name from UI/docs, user-provided scope notes.

**Analysis depth:**

- 1.1 Purpose: who reads this SRS and why (business stakeholders, QA, PO).
- 1.2 Scope: in-scope modules/capabilities from Module Map; out-of-scope explicitly listed.
- 1.3 Definitions: canonical business terms from FE labels (not code names).
- 1.4 References: evidence sources at business level only.

**Output contract:** Sections 1.1–1.4 per SKILL.md template. Mark uncertain boundaries `[CONFIRMATION REQUIRED]`.

**Anti-patterns:** Do not list file paths, frameworks, or repository structure in final text.

### Sec01_QA Checklist

- [ ] All four subsections present (1.1–1.4)
- [ ] Scope aligns with Module Map capability count (no orphan modules)
- [ ] No technical identifiers in business text
- [ ] Uncertain scope items carry `[CONFIRMATION REQUIRED]`
- [ ] Definitions use user-visible terms only

---

## Sec02_Specialist — Overall Description

**File:** `02-overall-description.md`

**Evidence inputs:** RepoMapper, FE_Scanner (navigation, actors), BE_Scanner (system boundaries).

**Analysis depth:**

- 2.1 Product Perspective: how the system fits the business context.
- 2.2 Product Functions: high-level capability groups per module.
- 2.3 User Classes: roles from permission checks and UI visibility.
- 2.4 Operating Environment: user-observable channels (web, mobile) only.
- 2.5 Constraints: business/policy constraints evidenced in code or docs.
- 2.6 Assumptions: only what evidence supports; else `[CONFIRMATION REQUIRED]`.

**Anti-patterns:** Do not invent user classes not seen in auth/role evidence.

### Sec02_QA Checklist

- [ ] User classes match role evidence from scanners
- [ ] Product functions cover all modules in Module Map
- [ ] No stack-specific implementation detail
- [ ] Assumptions are evidence-backed or marked `[CONFIRMATION REQUIRED]`

---

## Sec03_Specialist — Functional Requirements

**File:** `03-functional-requirements/module-[module-slug].md` (one file per module in Phase 2)

**Evidence inputs:** FE_Module, BE_Module, Capability Inventory, Evidence Ledger.

**Analysis depth:**

- One FR per evidenced capability or distinct system behavior.
- Format: `The system shall <behavior> [under <condition>].`
- Link each FR to Cap-ID in internal trace (business text only in file).
- Split umbrella verbs (create, view, edit, delete, approve) — never "manage X".

**Anti-patterns:** No FR without Cap-ID or cross-cutting evidence. No duplicate FRs for same capability.

### Sec03_QA Checklist

- [ ] Every Cap-ID in current module scope has at least one FR (or explicit gap with `[CONFIRMATION REQUIRED]`)
- [ ] FR statements are atomic and testable
- [ ] No technical leakage
- [ ] ID scheme consistent (FR-001, FR-002, …)
- [ ] No fabricated behaviors absent from ledger

---

## Sec04_Specialist — Non-Functional Requirements

**File:** `04-non-functional-requirements.md`

**Evidence inputs:** config files, deployment hints, performance patterns, logging, caching, rate limits.

**Analysis depth:**

- Performance, availability, scalability, usability, maintainability — only if evidenced.
- Measurable NFR where metrics exist in config/tests; else qualitative + `[CONFIRMATION REQUIRED]`.

**Anti-patterns:** Do not cite specific cloud services, library names, or internal architecture.

### Sec04_QA Checklist

- [ ] Each NFR is observable or verifiable at business level
- [ ] No infrastructure implementation detail
- [ ] Unverified NFRs marked `[CONFIRMATION REQUIRED]`

---

## Sec05_Specialist — External Interface Requirements

**File:** `05-external-interface-requirements.md`

**Evidence inputs:** FE_Scanner (UI patterns), BE_Scanner (external integrations), API consumer contracts.

**Analysis depth:**

- 5.1 User Interface: screen types, input patterns, feedback patterns (business language).
- 5.2–5.3 External interactions: business purpose, trigger, outcome — no endpoint names.
- 5.4 Physical channels only if user-observable.

### Sec05_QA Checklist

- [ ] UI requirements match evidenced screens/forms
- [ ] No API paths, HTTP methods, or protocol internals
- [ ] Integration points trace to BE scanner evidence

---

## Sec06_Specialist — Data Requirements

**File:** `06-data-requirements/module-[module-slug].md` (one file per module in Phase 2)

**Evidence inputs:** BE_Module domain models, schemas, validation contracts, FE form fields.

**Analysis depth:**

- 6.1 Business entities and attributes (business names).
- 6.2 Relationships (ownership, cardinality at business level).
- 6.3 Lifecycle states from status fields and transitions.
- 6.4 Validation rules merged from FE UX and BE enforcement.

### Sec06_QA Checklist

- [ ] Entities align with module domain evidence
- [ ] State names match user-visible labels
- [ ] Validation rules trace to FE and/or BE evidence
- [ ] No database column or ORM terminology

---

## Sec07_Specialist — Business Rules

**File:** `07-business-rules/module-[module-slug].md` (one file per module in Phase 2)

**Evidence inputs:** BE_Module conditionals, validation guards, FE disabled/hidden rules, state machines.

**Analysis depth:**

- Each BR: trigger → condition → action → violation outcome.
- Format: `The system shall <rule>.` with Violation Outcome column.
- Capture conflict resolution and approval thresholds from server logic.

**Anti-patterns:** Do not describe "service checks" or "guard denies" — state business policy outcomes.

### Sec07_QA Checklist

- [ ] Every BR traces to BE or FE enforcement evidence
- [ ] Violation outcomes are user-observable
- [ ] No implementation mechanics in rule text
- [ ] BR IDs link to related Cap-IDs internally

---

## Sec08_Specialist — Use Cases / User Stories

**File:** `08-use-cases-user-stories/module-[module-slug].md` (one file per module in Phase 2)

**Evidence inputs:** Complete module Capability Inventory, FE_Module flows, BE_Module operations.

**Analysis depth:**

- **8.1 Inventory:** every Cap-ID with UC-ID, US-ID, confidence — no omissions.
- **8.2 Detailed UC:** Main Flow + Alternate Flows + Exception Flows for every UC.
- **8.3 User Stories:** As a / I want / So that + Given/When/Then AC for every US.
- **8.4 Traceability:** FR ↔ UC ↔ US matrix for the module.

Read [reference.md](reference.md) for UC/US templates and anti-patterns.

**Coverage rules:** `count(UC) >= count(capabilities)`, `count(US) >= count(UC)`.

### Sec08_QA Checklist

- [ ] Inventory complete before 8.2/8.3 reviewed
- [ ] count(UC) >= count(Cap-ID in module)
- [ ] count(US) >= count(UC)
- [ ] Every UC has numbered Main Flow and Alternate Flows for observable branches
- [ ] No "representative" or "similar cases" wording
- [ ] No summary-only Section 8 without detailed cards
- [ ] Traceability matrix has no `Missing` without `[CONFIRMATION REQUIRED]`

---

## Sec09_Specialist — Error Handling

**File:** `09-error-handling.md`

**Evidence inputs:** error handlers, API error responses, FE error messages, validation failures.

**Analysis depth:**

- ERR-ID per distinct user-visible error scenario.
- User-facing message (from UI copy where available).
- Expected behavior in business terms.

### Sec09_QA Checklist

- [ ] Error scenarios trace to evidenced handlers/messages
- [ ] Messages use actual user-visible copy where available
- [ ] No stack traces or HTTP status codes in business text
- [ ] Unverified errors marked `[CONFIRMATION REQUIRED]`

---

## Sec10_Specialist — Security Requirements

**File:** `10-security-requirements.md`

**Evidence inputs:** auth flows, RBAC, permission middleware, sensitive data handling.

**Analysis depth:**

- Authentication requirements for protected capabilities.
- Authorization by role/permission (business policy outcomes).
- Data protection (transit/rest) — `[CONFIRMATION REQUIRED]` if not evidenced.

**Anti-patterns:** No token formats, algorithm names, or middleware names.

### Sec10_QA Checklist

- [ ] Auth requirements match protected routes/endpoints evidence
- [ ] Role restrictions align with FE visibility and BE enforcement
- [ ] Policy outcomes only — no mechanism detail

---

## Sec11_Specialist — Acceptance Criteria

**File:** `11-acceptance-criteria.md`

**Evidence inputs:** Sec08 user story AC, critical FR list, module traceability.

**Analysis depth:**

- Consolidate testable AC for critical FRs and cross-cutting concerns.
- Format: `When [condition], the system shall [observable outcome].`
- Cross-reference US-ID and FR-ID (business section, not code).

### Sec11_QA Checklist

- [ ] AC cover critical FRs from all modules
- [ ] AC align with Sec08 story acceptance criteria (no contradiction)
- [ ] Each AC is observable and testable

---

## Sec12_Merger — Appendix

**File:** `12-appendix.md`

**Evidence inputs:** all section files, Evidence Ledger, Section QA Summary (Appendix B).

**Analysis depth:**

- A: ID reference tables (FR, NFR, BR, UC, US, ERR, AC, CAP).
- B: Consolidated `[CONFIRMATION REQUIRED]` list + **Section QA Summary** table.
- C: Revision history.
- D: Cross-Module UC/US Index and coverage totals.

### Sec12_QA Checklist

- [ ] Appendix B includes every Section QA WARN/FAIL entry
- [ ] Coverage summary totals match per-module counts
- [ ] ID reference has no orphan IDs
- [ ] All conflicts from Evidence Ledger documented

---

## FinalQA

**Scope:** Entire SRS at resolved output path.

**Inputs:** All section files, Appendix B QA Summary, Evidence Ledger, Module Completion Checklists.

**Checks:**

- All global section files exist; split section README indexes and module files exist and are linked from root README.
- Aggregated Section QA: list total PASS/WARN/FAIL counts.
- UC/US coverage validation per SKILL.md Final Validation Gate.
- Cross-section ID consistency (FR in Sec03 matches Sec08 traceability).
- Docs Output Validation from SKILL.md.

Deliver PASS or FAIL with module-level coverage summary. FAIL items must be listed in Appendix B — do not block delivery if items are marked `[CONFIRMATION REQUIRED]`.

---

## Phase Dispatch Summary

### Phase 1

1. Evidence (parallel): RepoMapper, FE_Scanner, BE_Scanner
2. Merge → Module Map + Evidence Ledger draft
3. Writers (parallel): Sec01_Specialist, Sec02_Specialist
4. QA (parallel, readonly): Sec01_QA, Sec02_QA
5. Log QA results → init `12-appendix.md` with Appendix B template

### Phase 2 (per module)

1. Evidence (parallel): FE_Module, BE_Module
2. Merge → module Capability Inventory
3. Writers (parallel): Sec03, Sec06, Sec07, Sec08_Specialist
4. QA (parallel, readonly): Sec03_QA, Sec06_QA, Sec07_QA, Sec08_QA
5. Log QA → optional GapFill for Sec08 missing Cap-IDs
6. Continue to next module (non-blocking on QA FAIL)

### Phase 3

1. Writers (parallel): Sec04, Sec05, Sec09, Sec10, Sec11_Specialist
2. QA (parallel, readonly): Sec04_QA through Sec11_QA
3. Sec12_Merger → finalize appendix
4. Sec12_QA + FinalQA (parallel or sequential)
5. Update README status = Complete

## Tier Scaling

| Tier | Specialist + QA |
|------|-----------------|
| **Trivial** | Orchestrator may combine 2–3 section roles in one subagent; run QA checklists inline |
| **Normal** | Mandatory separate specialist + QA per section written in the phase |
| **Large** | Full fan-out; maximum parallel dispatch |

---

## Prompt Templates

Replace bracket placeholders. Always include `Output path: [resolved]` and relevant artifacts.

### SecNN_Specialist (template)

```
You are Sec[NN]_Specialist for fullstack-to-srs.
Repository: [path]
Output path: [resolved docs path]
Module: [ModuleName or all]
Evidence Ledger: [paste or path]
Capability Inventory: [if applicable]
Prior artifacts: [RepoMapper, FE_Module, etc.]

Read section-agents.md playbook for Sec[NN]_Specialist.
Write [filename] with deep analysis per playbook.
Business language only. Link all items to Cap-IDs.
Mark uncertain items [CONFIRMATION REQUIRED].
Persist to Output path. Use specialist return format from section-agents.md.
```

### SecNN_QA (template)

```
You are Sec[NN]_QA for fullstack-to-srs.
Repository: [path]
Output path: [resolved docs path]
Module: [ModuleName or all]
Evidence Ledger: [paste]
Section or module file to validate: [filename]
Section index to validate, when applicable: [section README path]
Specialist artifact: [if separate from file]

Readonly: do not modify source code, section files, section indexes, or module files.
Read section-agents.md QA checklist for Sec[NN].
Audit: evidence traceability, fabrication check, completeness.
Return QA report format from section-agents.md.
Status PASS | WARN | FAIL. On FAIL/WARN: list items for [CONFIRMATION REQUIRED].
Do not block pipeline — Orchestrator logs and continues.
```

### Sec08_Specialist

```
You are Sec08_Specialist for fullstack-to-srs.
Repository: [path], Module: [ModuleName], code: [MODCODE]
Output path: [resolved docs path]
Capability Inventory: [complete table with UC-ID, US-ID assignments]

Write the full module file (8.1-8.4) per output-layout.md module file protocol.
Read reference.md for UC/US templates. EVERY capability gets UC + US.
Persist to `08-use-cases-user-stories/module-[module-slug].md` and update `08-use-cases-user-stories/README.md`.
Use specialist return format from section-agents.md.
```

### Sec12_Merger

```
You are Sec12_Merger for fullstack-to-srs.
Output path: [resolved docs path]
Inputs: all section files, Evidence Ledger, Section QA Summary entries.

Finalize 12-appendix.md: ID reference, CONFIRMATION REQUIRED list,
Section QA Summary table, cross-module coverage index.
Use specialist return format from section-agents.md.
```

### FinalQA

```
You are FinalQA for fullstack-to-srs.
Output path: [resolved docs path]
Inputs: all section files, Appendix B QA Summary, Evidence Ledger.

Readonly: validate entire SRS per Final Validation Gate in SKILL.md.
Aggregate all Section QA reports. Cross-check ID consistency across sections.
Return QA report format with overall PASS | FAIL and per-module coverage summary.
```
