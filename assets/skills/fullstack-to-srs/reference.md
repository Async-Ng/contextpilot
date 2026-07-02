# Fullstack To SRS - UC/US Reference

Use this file when populating Section 8. Read after the main rules in SKILL.md.

For section specialist playbooks and per-section QA checklists, see [section-agents.md](section-agents.md).

## Anti-Patterns (Never Produce These)

| Anti-Pattern | Why It Fails | Correct Approach |
|--------------|--------------|------------------|
| "Representative use cases" | Skips evidenced capabilities | Inventory all capabilities first, then write every UC |
| "Similar use cases follow the same pattern" | Hides unique business rules | One UC per capability with its own flows |
| Single UC for "Manage Users" | Too vague, untestable | Split: UC create user, UC edit user, UC deactivate user, etc. |
| Section 8 with only summary table | No testable flows | Add 8.2 detailed cards and 8.3 user stories |
| `...` or `TBD` placeholders | Incomplete deliverable | Write full content or mark `[CONFIRMATION REQUIRED]` with specific gap |
| One US covering multiple goals | Violates INVEST | One primary goal per US; split if needed |
| Skipping alternate flows | Misses validation and permission behavior | Add AF for every observable rejection, validation, and permission branch |
| Ending phase with "core" cases only | Violates completeness rules | All capabilities in module must be mapped |
| Parent agent skips section specialists on Normal/Large project | Misses coverage and accuracy | Follow orchestration.md and section-agents.md tier rules |
| SRS only in chat, not on disk | Loses deliverable artifacts | Persist section files per output-layout.md |

## Capability Inventory Example

Module: Order Management

| Cap-ID | Business Capability | Primary Actor | Related FR | UC-ID | US-ID | Evidence Confidence |
|--------|---------------------|---------------|------------|-------|-------|---------------------|
| CAP-ORD-001 | View order list | Sales Staff | FR-010 | UC-010 | US-010 | Confirmed |
| CAP-ORD-002 | Create new order | Sales Staff | FR-011 | UC-011 | US-011 | Confirmed |
| CAP-ORD-003 | Edit draft order | Sales Staff | FR-012 | UC-012 | US-012 | Confirmed |
| CAP-ORD-004 | Cancel submitted order | Sales Manager | FR-013 | UC-013 | US-013 | Likely |
| CAP-ORD-005 | Export order report | Finance Staff | FR-014 | UC-014 | US-014 | Unverified [CONFIRMATION REQUIRED] |

Note: CAP-ORD-005 stays in inventory even when evidence is weak — never drop unverified capabilities.

## Detailed Use Case Card Template

### UC-011: Create New Order

- **Actor:** Sales Staff
- **Goal:** Register a new customer order with line items and delivery details
- **Preconditions:** Actor is authenticated; actor has permission to create orders
- **Postconditions:** Order is saved in Draft status and visible in the order list
- **Related FR:** FR-011 | **Related BR:** BR-050, BR-060

**Main Flow:**
1. Actor opens the Create Order screen.
2. Actor selects or enters customer information.
3. Actor adds one or more line items with quantity and unit price.
4. Actor enters delivery address and requested delivery date.
5. Actor submits the order.
6. The system validates all required fields and business rules.
7. The system saves the order in Draft status.
8. The system displays a success confirmation with the new order reference.

**Alternate Flows:**
- **AF-011-a:** At step 3, actor adds zero line items → The system shall block submission and display a message that at least one line item is required.
- **AF-011-b:** At step 6, requested delivery date is in the past → The system shall reject the submission and prompt for a valid future date.
- **AF-011-c:** At step 6, customer credit limit is exceeded → The system shall block submission and display the credit limit policy message. [CONFIRMATION REQUIRED]

**Exception Flows:**
- **EF-011-a:** Network or system unavailable at step 7 → see ERR-003

---

### UC-013: Cancel Submitted Order

- **Actor:** Sales Manager
- **Goal:** Cancel an order that has already been submitted but not yet fulfilled
- **Preconditions:** Order exists in Submitted status; actor has cancel permission
- **Postconditions:** Order status changes to Cancelled; cancellation is recorded
- **Related FR:** FR-013 | **Related BR:** BR-001

**Main Flow:**
1. Actor opens the order detail for a Submitted order.
2. Actor selects Cancel Order.
3. The system prompts for a cancellation reason.
4. Actor enters reason and confirms cancellation.
5. The system validates cancellation eligibility.
6. The system updates order status to Cancelled.
7. The system displays cancellation confirmation.

**Alternate Flows:**
- **AF-013-a:** At step 5, order is already in fulfillment → The system shall deny cancellation and explain that fulfillment has started.
- **AF-013-b:** At step 3, actor dismisses the dialog → The system shall return to order detail with no change.

**Exception Flows:**
- **EF-013-a:** Concurrent status change during cancellation → see ERR-007

## User Story Template

### US-011: Create a new order

**As a** Sales Staff
**I want** to create a new order with customer details, line items, and delivery information
**So that** I can record customer purchases and initiate fulfillment

**Related UC:** UC-011

**Acceptance Criteria:**
- [ ] AC-US-011-01: Given the actor is on the Create Order screen, When all required fields and at least one line item are provided with valid values, Then the system shall save the order in Draft status and show a success confirmation with the order reference.
- [ ] AC-US-011-02: Given the actor submits without line items, When validation runs, Then the system shall block submission and display a message requiring at least one line item.
- [ ] AC-US-011-03: Given the requested delivery date is in the past, When the actor submits, Then the system shall reject the submission and prompt for a valid future date.

---

### US-013: Cancel a submitted order

**As a** Sales Manager
**I want** to cancel a submitted order that has not entered fulfillment
**So that** incorrect or obsolete orders do not proceed to delivery

**Related UC:** UC-013

**Acceptance Criteria:**
- [ ] AC-US-013-01: Given a Submitted order not in fulfillment, When the manager provides a cancellation reason and confirms, Then the system shall change the order status to Cancelled and show confirmation.
- [ ] AC-US-013-02: Given an order already in fulfillment, When the manager attempts cancellation, Then the system shall deny the action and explain that fulfillment has started.

## US Rules

- At least one US per UC.
- Add a separate US when an alternate flow involves a different actor or materially different goal.
- Acceptance criteria use Given / When / Then and describe observable outcomes only.
- Do not merge create + edit + delete into one user story.

## Traceability Matrix Example

| FR-ID | UC-ID | US-ID | Module | Coverage Status |
|-------|-------|-------|--------|-----------------|
| FR-010 | UC-010 | US-010 | Order | Complete |
| FR-011 | UC-011 | US-011 | Order | Complete |
| FR-012 | UC-012 | US-012 | Order | Complete |
| FR-013 | UC-013 | US-013 | Order | Complete |
| FR-014 | UC-014 | US-014 | Order | Partial [CONFIRMATION REQUIRED] |

## Cross-Module Coverage Summary Example

| Module | Capabilities | Use Cases | User Stories | Open [CONFIRMATION REQUIRED] |
|--------|--------------|-----------|--------------|------------------------------|
| Auth | 6 | 6 | 7 | 0 |
| Order | 5 | 5 | 6 | 1 |
| Inventory | 8 | 8 | 9 | 2 |
| **Total** | **19** | **19** | **22** | **3** |

Rules:
- Use Cases must equal or exceed Capabilities (one UC per capability minimum).
- User Stories must equal or exceed Use Cases (one US per UC minimum).
- Open `[CONFIRMATION REQUIRED]` count must match Appendix B entries for the module.

## Orchestration Reminder

Parent agent acts as **Orchestrator** by default. Read [orchestration.md](orchestration.md) and [section-agents.md](section-agents.md) on skill invocation.

```
1. Assess project size tier (Trivial / Normal / Large)
2. Phase 1: Evidence agents → Sec01/Sec02 specialists → Sec01/Sec02 QA
3. Phase 2 per module: FE_Module + BE_Module → Sec03/06/07/08 specialists → Section QA
4. Log Section QA to Appendix B; patch [CONFIRMATION REQUIRED] on WARN/FAIL; continue
5. GapFill only for Sec08_QA missing Cap-IDs
6. Phase 3: Sec04/05/09/10/11 specialists → QA → Sec12_Merger → FinalQA
7. Final merge + deliver; persist all section files
```

Do not skip section specialists or Section QA on Normal/Large projects.

## Docs Output Reminder

Read [output-layout.md](output-layout.md) for file paths and naming.

- Default output: `{projectRoot}/docs/srs/`
- Phase 1: write `README.md`, `01-introduction.md`, `02-overall-description.md`, create section README indexes for `03`, `06`, `07`, `08`, initialize `12-appendix.md` with Appendix B QA template
- Phase 2: write/update one module file per section under `03`, `06`, `07`, and `08`; update each section README index
- Phase 3: complete `04`, `05`, `09`, `10`, `11`, `12`; set README status = Complete
- Chat is summary only; full SRS content must be on disk

## Workflow Reminder

```
1. Discover capabilities from code evidence
2. Build Cap-ID inventory (8.1)
3. Assign UC-ID and US-ID to every Cap-ID
4. Write detailed UC cards (8.2) — all of them
5. Write user stories (8.3) — all of them
6. Fill traceability matrix (8.4)
7. Run Module Completion Checklist
8. Persist section/module files to docs output path
9. Only then proceed to next module or finalization
```

Do not write 8.2 or 8.3 until step 2 is complete for the current module.
