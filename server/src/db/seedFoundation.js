import { newId } from './connection.js';

/**
 * Seed / upsert data for the Foundation Integration extension's platform-
 * wide reference catalogs (gates, stage_definitions, stage_gate_map,
 * sprints, calendar_weeks, gate_rubric_criteria) plus the ten CSE themes
 * (project_themes, institute_id = NULL).
 *
 * Source of truth: "Mini Project Handbook - Computer Science and
 * Engineering" (Handbook v4, Sept 2026) and the companion "Generic Mini
 * Project Framework" deck (v1, 5 Sept 2026). Where the two sources
 * describe the same thing slightly differently (e.g. stage ranges inside a
 * sprint), the handbook's prose is treated as authoritative and the deck
 * is used only to fill in details the handbook doesn't spell out (the
 * sprint-to-gate closing map).
 *
 * UPSERT, not insert-if-missing: gates/stages/sprints/calendar/rubrics are
 * pedagogy, not user data - a corrected mark weight or stage name in a
 * later handbook revision must reach an already-running deployment on the
 * next server start, without a destructive reset and without silently
 * keeping stale numbers around. project_themes is the one exception: it
 * stays insert-if-missing (by code) because owner_faculty_user_id is real,
 * live faculty ownership data that a reseed must never clobber.
 */

const SIX_COURSES = [
  'Data Structures & Algorithms',
  'Database Management Systems',
  'Operating Systems',
  'Software Engineering & SDLC',
  'Web Technologies & Networks',
  'Discrete Mathematics',
];

// ---------------------------------------------------------------------------
// Gates (Handbook Sec 1.12): 5 gates, 50 marks total.
// ---------------------------------------------------------------------------
const GATES = [
  {
    id: 'GATE_0', sequence: 0, name: 'Gate 0 - Problem Approval', marks_weight: 5,
    stage_range: 'S0', course_outcomes: ['CO1'], default_week_number: 2,
    primary_review_focus: 'Problem framing, stakeholders, scope, feasibility, risks, initial success criteria',
  },
  {
    id: 'GATE_1', sequence: 1, name: 'Gate 1 - Requirements Baseline', marks_weight: 10,
    stage_range: 'S1', course_outcomes: ['CO2'], default_week_number: 4,
    primary_review_focus: 'FR/NFR testability, use cases, acceptance criteria, RTM, engine decomposition and ownership',
  },
  {
    id: 'GATE_2', sequence: 2, name: 'Gate 2 - Architecture and Interface Design', marks_weight: 10,
    stage_range: 'S2, S3, S4', course_outcomes: ['CO3'], default_week_number: 9,
    primary_review_focus: 'System structure with stated rationale, engine boundaries, ER model, API contracts, algorithm specifications, dependency map',
  },
  {
    id: 'GATE_3', sequence: 3, name: 'Gate 3 - Technical Implementation and Engine Readiness', marks_weight: 15,
    stage_range: 'S5, S6 (engine-level), S7 (in progress)', course_outcomes: ['CO4', 'CO5'], default_week_number: 13,
    primary_review_focus: 'Implementation discipline, version-control history, unit and engine tests, KPI evidence, RCA started, interface compatibility',
  },
  {
    id: 'GATE_4', sequence: 4, name: 'Gate 4 - Final Validation, Integration and Release', marks_weight: 10,
    stage_range: 'S6 (system-level), S7', course_outcomes: ['CO4', 'CO5'], default_week_number: 16,
    primary_review_focus: 'End-to-end testing, KPI compliance, regression, defect closure, RTM, debugging log, report, demonstration and individual viva',
  },
];

// ---------------------------------------------------------------------------
// Stages (Handbook Table 1.7 - Sequential Foundation, 1.8 - Agile stages).
// Only S0 carries a full evidence checklist: it is the only stage this
// handbook revision documents down to a faculty-execution and evidence
// level (Chapter 2 + the Gate 0 Phase Assessment Sheet). S1-S7 carry their
// primary question / expected outcome only, until a future chapter of the
// handbook documents them the same way S0 is documented here.
// ---------------------------------------------------------------------------
const S0_EVIDENCE_CHECKLIST = [
  'Problem Discovery Note',
  'Stakeholder Identification / Need Table',
  'AS-IS Workflow / Current Process',
  'Problem Statement',
  'Scope & Out-of-Scope Statement',
  'Technical & Operational Feasibility Note',
  'Initial Risk & Constraint Register',
  'Initial KPI / Success-Criteria Sheet',
];

const STAGES = [
  {
    id: 'S0', sequence: 0, name: 'Problem Definition and Need Identification', is_sequential_foundation: 1,
    primary_question: 'What problem are we solving and why?',
    expected_outcome: 'Stakeholders, scope, feasibility, risks and initial success criteria',
    evidence_checklist: S0_EVIDENCE_CHECKLIST,
  },
  {
    id: 'S1', sequence: 1, name: 'Functional Requirements Engineering', is_sequential_foundation: 1,
    primary_question: 'What must the system do?',
    expected_outcome: 'FR/NFR, use cases and user stories, acceptance criteria and traceability',
    evidence_checklist: null,
  },
  {
    id: 'S2', sequence: 2, name: 'System Architecture Design', is_sequential_foundation: 0,
    primary_question: 'How will the system be organised, and why does each boundary exist?',
    expected_outcome: 'Layered architecture, engine boundaries, interfaces, and a stated design principle behind every boundary',
    evidence_checklist: null,
  },
  {
    id: 'S3', sequence: 3, name: 'Data Model and API Design', is_sequential_foundation: 0,
    primary_question: 'What data is required and how will components communicate?',
    expected_outcome: 'ER model, normalised schema, storage and retrieval design, API contracts with full status-code coverage',
    evidence_checklist: null,
  },
  {
    id: 'S4', sequence: 4, name: 'Algorithm and Business Logic Design', is_sequential_foundation: 0,
    primary_question: 'How will the system make decisions and enforce rules?',
    expected_outcome: 'Pseudocode or formal notation for all non-trivial logic, state models, complexity analysis, concurrency strategy',
    evidence_checklist: null,
  },
  {
    id: 'S5', sequence: 5, name: 'Implementation', is_sequential_foundation: 0,
    primary_question: 'How is the approved design converted into working software?',
    expected_outcome: 'Working increments with a version-control history readable as a development narrative',
    evidence_checklist: null,
  },
  {
    id: 'S6', sequence: 6, name: 'Testing and Validation', is_sequential_foundation: 0,
    primary_question: 'Does the implementation satisfy the requirements - including the cases we would rather not think about?',
    expected_outcome: 'Happy-path, negative, boundary, concurrency, security and performance evidence, with documented failures',
    evidence_checklist: null,
  },
  {
    id: 'S7', sequence: 7, name: 'Root Cause Analysis and Improvement', is_sequential_foundation: 0,
    primary_question: 'Why did failures occur and what does that reveal about the design?',
    expected_outcome: 'Debugging log, corrective action at design level, regression evidence and validated closure',
    evidence_checklist: null,
  },
];

// Handbook Table 1.12's "Maturity evaluated" column - Gate 3 and Gate 4
// both draw on S6/S7 (engine-level-in-progress vs system-level-closed), so
// this is a many-to-many map, not a single FK per stage.
const STAGE_GATE_MAP = [
  ['S0', 'GATE_0'],
  ['S1', 'GATE_1'],
  ['S2', 'GATE_2'], ['S3', 'GATE_2'], ['S4', 'GATE_2'],
  ['S5', 'GATE_3'], ['S6', 'GATE_3'], ['S7', 'GATE_3'],
  ['S6', 'GATE_4'], ['S7', 'GATE_4'],
];

// ---------------------------------------------------------------------------
// Sprints (Handbook Sec 1.10-1.11; stage ranges and gate closure per the
// companion deck's Sec D "How Sprints Are Decided", slide 22).
// ---------------------------------------------------------------------------
const SPRINTS = [
  {
    id: 'SPRINT_1', sequence: 1, name: 'Sprint 1', stage_range: 'S2-S3', closes_gate_id: 'GATE_2',
    objective: 'Architecture and technical design baseline',
    purpose: 'Establish shared architecture and allow engines to progress through architecture, data/API and technical design according to readiness.',
  },
  {
    id: 'SPRINT_2', sequence: 2, name: 'Sprint 2', stage_range: 'S4-S5', closes_gate_id: 'GATE_3',
    objective: 'Core build, engine validation and integration readiness',
    purpose: 'Allow engines to progress in parallel through implementation, testing, RCA and readiness based on technical maturity.',
  },
  {
    id: 'SPRINT_3', sequence: 3, name: 'Sprint 3', stage_range: 'S6-S7', closes_gate_id: 'GATE_4',
    objective: 'System integration, final validation and release',
    purpose: 'Integrate ready engines, validate end-to-end behaviour, complete RCA and hardening, and prepare final release.',
  },
];

// ---------------------------------------------------------------------------
// Gate rubric criteria. Gate 0's four criteria and their full 0-5
// performance descriptors are transcribed verbatim from the Handbook's
// Gate 0 Assessment Rubric. Gates 1-4 are reconstructed from Table 1.3.1's
// CO -> stage -> gate -> marks breakdown: each component phrase is matched
// to the gate whose Table-1.12 "primary review focus" it corresponds to,
// and the match is only used where the resulting weights sum exactly to
// the gate's stated total (Gate 1 = 10, Gate 2 = 10, Gate 3 = 15, Gate 4 =
// 10 including a 2-mark individual viva) - so this is a verified
// reconstruction, not a guess. Table 1.3.1's own "CO4: 25 marks" figure is
// internally inconsistent with its own listed components (which sum to 8)
// and is not used directly; 25 is actually Gate 3 + Gate 4 combined (15 +
// 10), most likely a merged-cell artefact from the source document. Level
// descriptors for Gates 1-4 are left null until a future handbook chapter
// defines them - see the schema comment on gate_rubric_criteria.
// ---------------------------------------------------------------------------
const GATE_0_CRITERIA = [
  {
    name: 'Problem Discovery & Stakeholder Evidence', weight: 1.25,
    descriptors: {
      5: 'Verified, specific need; relevant stakeholders, roles, pain points and needs are accurate. Evidence is dated/traceable; assumptions are clearly separated.',
      4: 'Problem and stakeholders are clear and supported by credible evidence; only minor gaps in depth, traceability or secondary-stakeholder coverage.',
      3: 'Problem and primary stakeholders are identified. Evidence exists, but the evidence-to-need linkage or stakeholder analysis is incomplete.',
      2: 'Problem is broad or partly defined. Evidence is limited/descriptive; stakeholder needs are generic or weakly linked to the stated problem.',
      1: 'Work is mainly a solution idea. Stakeholder relevance is assumed; evidence is weak, anecdotal, undated or poorly connected to the problem.',
      0: 'No clear problem baseline, relevant stakeholder need or verifiable evidence.',
    },
  },
  {
    name: 'AS-IS Workflow, Problem Statement & Scope', weight: 1.25,
    descriptors: {
      5: 'AS-IS workflow captures actors, key steps, hand-offs/decisions and pain points. Problem statement follows from evidence; scope boundaries are explicit and realistic.',
      4: 'Workflow, problem statement and scope are coherent and mostly complete, with only minor omissions or ambiguity.',
      3: 'Basic current process and problem statement are understandable. Scope is usable, but some actors, steps, pain points or boundaries are not fully specified.',
      2: 'Workflow is partial/inconsistent. Problem statement may mix symptoms and solution; scope is broad, incomplete or unclear.',
      1: 'AS-IS view is fragmented/generic. Problem statement is vague; scope/out-of-scope is largely missing, contradictory or disconnected.',
      0: 'AS-IS workflow, problem statement or scope is missing or cannot be explained.',
    },
  },
  {
    name: 'Feasibility, Risks & Initial Success Criteria', weight: 1.25,
    descriptors: {
      5: 'Technical and operational feasibility are reasoned against resources and constraints. Major risks include impact. KPIs are specific, measurable and aligned.',
      4: 'Feasibility and key risks are realistic and justified. Success criteria are mostly measurable and aligned, with minor gaps in prioritisation or precision.',
      3: 'Basic feasibility is established. Important risks and measurable indicators are identified, but analysis lacks depth, prioritisation or strong alignment.',
      2: 'Feasibility is asserted more than analysed. Risks are generic/incomplete; success criteria are mainly qualitative or only partly measurable.',
      1: 'Feasibility discussion is minimal; risks are superficial; KPIs are vague, unrealistic or disconnected from the problem.',
      0: 'Feasibility, risks/constraints and initial success criteria are not established.',
    },
  },
  {
    name: 'Evidence Authenticity & Individual Understanding', weight: 1.25,
    descriptors: {
      5: 'Evidence is created during S0, dated and traceable. Student independently explains all S0 decisions, answers probing questions consistently and states own contribution.',
      4: 'Evidence is authentic and timely. Student explains almost all S0 decisions independently and accurately, requiring only minor clarification.',
      3: 'Evidence is mostly valid. Student explains core S0 elements but needs occasional prompts or shows limited depth in one area / own contribution.',
      2: 'Evidence has timing, traceability or attribution gaps. Explanation is partial, relies noticeably on notes/team members, or cannot justify several decisions.',
      1: 'Evidence appears retrospective, undated or weakly attributable. Student demonstrates minimal independent understanding of S0 work or contribution.',
      0: 'No credible evidence is available, or the student cannot explain the S0 baseline and own contribution.',
    },
  },
];

const RUBRIC_CRITERIA_BY_GATE = {
  GATE_0: GATE_0_CRITERIA,
  GATE_1: [
    { name: 'SRS with FR/NFR', weight: 6, descriptors: null },
    { name: 'Traceability Matrix', weight: 2, descriptors: null },
    { name: 'Engine Decomposition and Ownership', weight: 2, descriptors: null },
  ],
  GATE_2: [
    { name: 'System Architecture', weight: 4, descriptors: null },
    { name: 'Data Model and API Design', weight: 3, descriptors: null },
    { name: 'Algorithm and Business Logic Design', weight: 3, descriptors: null },
  ],
  GATE_3: [
    { name: 'Implementation and Version-Control Discipline', weight: 6, descriptors: null },
    { name: 'Engine Testing', weight: 6, descriptors: null },
    { name: 'RCA in Progress', weight: 3, descriptors: null },
  ],
  GATE_4: [
    { name: 'Final Working System', weight: 2, descriptors: null },
    { name: 'System Validation and Regression', weight: 3, descriptors: null },
    { name: 'RCA Closure', weight: 1, descriptors: null },
    { name: 'Report and Traceability', weight: 2, descriptors: null },
    { name: 'Individual Viva', weight: 2, descriptors: null },
  ],
};

// ---------------------------------------------------------------------------
// COE-aligned calendar (Handbook Table 1.15): Week 1 begins 7 September
// 2026, 17 weeks, ending 29 December 2026. Transcribed row-for-row.
// ---------------------------------------------------------------------------
const ACADEMIC_YEAR = '2026-27';
const CALENDAR_WEEKS = [
  { week: 1, start: '2026-09-07', end: '2026-09-13', activity: 'Sequential Foundation - S0', stages: ['S0'], gate: null, sprint: null, protected: false,
    output: 'Problem definition, stakeholders, scope, feasibility, constraints, risk register, initial success and KPI criteria. Repository created this week; the problem document is its first commit.' },
  { week: 2, start: '2026-09-14', end: '2026-09-20', activity: 'GATE 0 - Problem Approval (5 marks)', stages: ['S0'], gate: 'GATE_0', sprint: null, protected: false,
    output: 'Formal review of Week 1 evidence. Problem baseline approved before requirements work begins. No source code exists yet; the repository contains documentation only.' },
  { week: 3, start: '2026-09-21', end: '2026-09-27', activity: 'Sequential Foundation - S1', stages: ['S1'], gate: null, sprint: null, protected: false,
    output: 'SRS with FR/NFR, use cases and user stories, acceptance criteria, RTM, requirement clustering, engine identification with named owners, KPI definition.' },
  { week: 4, start: '2026-09-28', end: '2026-10-04', activity: 'GATE 1 - Requirements Baseline (10 marks)', stages: ['S1'], gate: 'GATE_1', sprint: null, protected: false,
    output: 'Requirements completeness, testability and traceability reviewed. Engine decomposition and individual ownership approved. The FR document must be committed before the first source-code commit - verified in the repository log.' },
  { week: 5, start: '2026-10-05', end: '2026-10-11', activity: 'Sprint 1 - Shared Architecture Baseline', stages: ['S2'], gate: null, sprint: 'SPRINT_1', protected: false,
    output: 'Overall layered architecture, engine boundaries, common services, communication and security model, shared interface baseline. Each boundary annotated with the design principle and course that governs it.' },
  { week: 6, start: '2026-10-12', end: '2026-10-18', activity: 'NO FORMAL REVIEW (Minor-I protected week)', stages: [], gate: null, sprint: null, protected: true,
    output: 'Minor-I protected week. Students may maintain documentation and repository individually if possible. No compulsory Mini Project activity.' },
  { week: 7, start: '2026-10-19', end: '2026-10-25', activity: 'Sprint 1 - Engine Technical Design', stages: ['S2', 'S3'], gate: null, sprint: 'SPRINT_1', protected: false,
    output: 'Per engine: internal architecture, data and state ownership, interface contract, dependencies, algorithm or mechanism specification, failure behaviour. ER model and API specification drafted.' },
  { week: 8, start: '2026-10-26', end: '2026-11-01', activity: 'Sprint 1 - Design Closure and Evidence Consolidation', stages: ['S3', 'S4'], gate: null, sprint: 'SPRINT_1', protected: false,
    output: 'Freeze architecture, API contracts, state and data model, algorithm pseudocode. Commit all design artefacts and resolve any dependency cycles before the gate.' },
  { week: 9, start: '2026-11-02', end: '2026-11-08', activity: 'GATE 2 - Architecture and Interface Design Review (10 marks)', stages: ['S2', 'S3', 'S4'], gate: 'GATE_2', sprint: null, protected: false,
    output: 'Architecture rationale, API contracts, state and data ownership, technical mechanism, dependency map, failure behaviour and implementation readiness reviewed and marked.' },
  { week: 10, start: '2026-11-09', end: '2026-11-15', activity: 'Sprint 2 - Core Implementation', stages: ['S5'], gate: null, sprint: 'SPRINT_2', protected: false,
    output: 'S5 implementation of algorithms, concurrency, persistence, communication and engine functionality begins. Commits are granular and message-bearing from day one.' },
  { week: 11, start: '2026-11-16', end: '2026-11-22', activity: 'Sprint 2 - Build and Unit Validation', stages: ['S5', 'S6'], gate: null, sprint: 'SPRINT_2', protected: false,
    output: 'Implementation continues; unit and technical tests executed. Test plan committed before the first test run. CI configured and running on every push; requirement-to-code traceability maintained.' },
  { week: 12, start: '2026-11-23', end: '2026-11-29', activity: 'Sprint 2 - Engine Testing, RCA and Integration Readiness', stages: ['S6', 'S7'], gate: null, sprint: 'SPRINT_2', protected: false,
    output: 'Engine validation: functional, boundary, negative, concurrency, KPI and interface testing. Defects analysed and corrected at design level; tests rerun; pairwise interface compatibility checked. Debugging log started.' },
  { week: 13, start: '2026-11-30', end: '2026-12-06', activity: 'GATE 3 - Technical Implementation and Engine Readiness (15 marks)', stages: ['S5', 'S6', 'S7'], gate: 'GATE_3', sprint: null, protected: false,
    output: 'Implementation, algorithms, technical tests, KPI, RCA, regression, repository history and interface compatibility reviewed and marked. Engines declared Integration Ready.' },
  { week: 14, start: '2026-12-07', end: '2026-12-13', activity: 'NO FORMAL GATE (Minor-II protected week)', stages: [], gate: null, sprint: null, protected: true,
    output: 'Minor-II protected week. No compulsory Mini Project evaluation.' },
  { week: 15, start: '2026-12-14', end: '2026-12-20', activity: 'Sprint 3 - System Integration and Final Validation', stages: ['S6', 'S7'], gate: null, sprint: 'SPRINT_3', protected: false,
    output: 'End-to-end integration, cross-engine workflows, system and functional testing, concurrency, load, security and performance testing, major defect correction, final regression.' },
  { week: 16, start: '2026-12-21', end: '2026-12-27', activity: 'GATE 4 - Final Validation, Integration and Release Approval (10 marks)', stages: ['S6', 'S7'], gate: 'GATE_4', sprint: null, protected: false,
    output: 'Final demonstration under examiner-chosen conditions, individual viva, and evidence review: end-to-end operation, KPI compliance, regression, defect closure, RTM, debugging log, foundation integration map, report and release readiness.' },
  { week: 17, start: '2026-12-28', end: '2026-12-29', activity: 'Administrative Closure / Buffer', stages: [], gate: null, sprint: null, protected: false,
    output: 'No planned sprint or gate. Marks entry, evidence archiving, repository freeze and unavoidable administrative closure only.' },
];

// ---------------------------------------------------------------------------
// Themes - unchanged from v1; both source decks list the same ten CSE
// themes with identical foundation-course mappings.
// ---------------------------------------------------------------------------
const THEMES = [
  {
    code: 'RBAC-WORKFLOW', title: 'Role-Based Workflow Management System',
    academic_subtitle: 'User roles & permission design - Workflow state machine - Relational data model - REST API architecture - Access-control testing',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Role DAG; state machine as graph.' },
      { course: 'Database Management Systems', concepts: 'Normalised schema; transactions; trigger for rules.' },
      { course: 'Operating Systems', concepts: 'Concurrent approval race, resolved with named primitive; FD-based audit log.' },
      { course: 'Software Engineering & SDLC', concepts: 'Requirements + permission matrix dated pre-commit; API spec first; test plan (normal/violation/concurrent).' },
      { course: 'Web Technologies & Networks', concepts: 'REST API, authz at API layer, 403/409 codes.' },
      { course: 'Discrete Mathematics', concepts: 'Permission sets (union/intersection); formal state-transition relation.' },
    ],
    minimum_evidence: ['ER Diagram', 'Role-Permission Matrix', 'State Machine', 'API Specification', 'Access-Control Tests', 'Debugging Log'],
    final_artefact_description: 'Working web application where each role can perform only permitted actions, supported by a documented workflow state machine, relational data model, REST API specification, and negative/boundary access-control tests.',
  },
  {
    code: 'SEARCH-ENGINE', title: 'Multi-Process Search Engine with Persistent Index',
    academic_subtitle: 'Search architecture - Persistent inverted index - Ranking algorithm - Multi-process design - Query performance - Result quality evaluation',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Inverted index, hash maps, posting lists, sorting/ranking and complexity.' },
      { course: 'Database Management Systems', concepts: 'Metadata schema, indexing, query optimisation and persistence.' },
      { course: 'Operating Systems', concepts: 'Processes, IPC, synchronization and crash consistency.' },
      { course: 'Software Engineering & SDLC', concepts: 'Pipeline architecture, requirements, testing and validation.' },
      { course: 'Web Technologies & Networks', concepts: 'HTTP query service, JSON responses and latency measurement.' },
      { course: 'Discrete Mathematics', concepts: 'Boolean/set operations and information-theoretic basis of tf-idf.' },
    ],
    minimum_evidence: ['Search Architecture', 'Persistent Index', 'Ranking Algorithm', 'Process + IPC Evidence', 'Performance & Quality Tests', 'Crash / Debug Log'],
    final_artefact_description: 'Working multi-process search system returning ranked results from a persistent inverted index, with documented search architecture, ranking logic, IPC/process design, measured query latency, precision/recall, and crash-recovery evidence.',
  },
  {
    code: 'TIMETABLE-SCHEDULING', title: 'Constraint-Based Timetable Scheduling System',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Conflict graph; graph-colouring; backtracking vs greedy.' },
      { course: 'Database Management Systems', concepts: 'Full schema (faculty/courses/rooms/slots); atomic assignment; validation trigger.' },
      { course: 'Operating Systems', concepts: 'Constraints mapped to a CPU-scheduling algorithm; deadlock via 4 conditions.' },
      { course: 'Software Engineering & SDLC', concepts: 'Constraints classed hard/soft pre-commit; validation report per run.' },
      { course: 'Web Technologies & Networks', concepts: 'Constraint input UI, export, progress over HTTP.' },
      { course: 'Discrete Mathematics', concepts: 'Formal CSP; chromatic number; deadlock as cycle.' },
    ],
  },
  {
    code: 'INVENTORY-TRANSACTIONS', title: 'Transaction-Based Inventory Management System',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Append-only ledger (O(1) append); FIFO reservation queue.' },
      { course: 'Database Management Systems', concepts: 'All 4 ACID properties demonstrated; triggers for stock/audit.' },
      { course: 'Operating Systems', concepts: 'Race condition - unprotected vs locked vs DB-isolated - tied to critical section.' },
      { course: 'Software Engineering & SDLC', concepts: 'Rules + enforcement layer specified first; validation across DB/app/UI.' },
      { course: 'Web Technologies & Networks', concepts: 'REST API; server-side validation; audit via API.' },
      { course: 'Discrete Mathematics', concepts: 'Stock invariant formalised; race as mutual-exclusion violation.' },
    ],
  },
  {
    code: 'LOG-ANALYSIS-ALERTING', title: 'Multi-Threaded Log Analysis and Alerting System',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Circular-buffer queue; KMP matching; alert decision tree.' },
      { course: 'Database Management Systems', concepts: 'Schema for entries/alerts/history; trend & time-series queries.' },
      { course: 'Operating Systems', concepts: 'Producer-consumer (reader/parser/alert threads); mutex+semaphore; file-monitor mechanism; 1000-entry burst test.' },
      { course: 'Software Engineering & SDLC', concepts: 'Pipeline architecture first; accuracy on >=50-entry log.' },
      { course: 'Web Technologies & Networks', concepts: 'HTTP webhook alerts; HTTP dashboard.' },
      { course: 'Discrete Mathematics', concepts: 'Regex as formal grammars; safety/liveness properties stated.' },
    ],
  },
  {
    code: 'P2P-FILE-SHARING', title: 'Peer-to-Peer File Sharing System',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Peer hash table; justified chunk size; SHA-256 integrity; peer set with expiry.' },
      { course: 'Database Management Systems', concepts: 'Local peer/file/transfer DB; search & cleanup queries.' },
      { course: 'Operating Systems', concepts: 'Full TCP lifecycle; UDP broadcast discovery via setsockopt.' },
      { course: 'Software Engineering & SDLC', concepts: 'Protocol spec first; discovery/transfer as separate tested modules.' },
      { course: 'Web Technologies & Networks', concepts: 'TCP vs UDP justified; ports documented; OSI-layer mapping.' },
      { course: 'Discrete Mathematics', concepts: 'Consistent hashing; collision probability (birthday paradox).' },
    ],
  },
  {
    code: 'KV-STORE-PERSISTENCE', title: 'In-Memory Key-Value Store with Persistence and Eviction',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Hash map + collision strategy; LRU via linked-list+hash (O(1)); WAL as sequenced log.' },
      { course: 'Database Management Systems', concepts: 'WAL for durability + recovery; periodic snapshotting.' },
      { course: 'Operating Systems', concepts: 'fsync latency measured; reader-writer lock; crash-and-recover test.' },
      { course: 'Software Engineering & SDLC', concepts: 'API spec first; fsync vs no-fsync benchmark.' },
      { course: 'Web Technologies & Networks', concepts: 'Custom TCP text protocol; multi-client demo.' },
      { course: 'Discrete Mathematics', concepts: 'Load-factor collision probability; WAL correctness formalised.' },
    ],
  },
  {
    code: 'BUILD-DEPENDENCY-MANAGER', title: 'Build System and Dependency Manager',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: "Dependency DAG; topological sort (Kahn's); cycle detection; parallel build levels." },
      { course: 'Database Management Systems', concepts: 'Build-history schema; incremental & failure-frequency queries.' },
      { course: 'Operating Systems', concepts: 'fork/exec spawning; pipe FD management; waitpid; stat for mtime; job-limited parallelism.' },
      { course: 'Software Engineering & SDLC', concepts: 'Build language spec first; 5-scenario test plan.' },
      { course: 'Web Technologies & Networks', concepts: 'Build status/output over HTTP; POST trigger.' },
      { course: 'Discrete Mathematics', concepts: 'Topological sort as partial-order extension; transitive closure.' },
    ],
  },
  {
    code: 'REALTIME-DOC-EDITOR', title: 'Collaborative Real-Time Document Editor',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Sequenced operation log; OT position adjustment; replay-based reconstruction.' },
      { course: 'Database Management Systems', concepts: 'Full operation-log store; reconstruct-by-sequence query.' },
      { course: 'Operating Systems', concepts: 'Reader-writer lock on shared doc state; WebSockets as socket FDs.' },
      { course: 'Software Engineering & SDLC', concepts: 'OT transformation rules spec first; 3-conflict + convergence test.' },
      { course: 'Web Technologies & Networks', concepts: 'WebSocket handshake + message spec; latency at 2/5 editors.' },
      { course: 'Discrete Mathematics', concepts: 'OT commutativity formalised; convergence as fixed-point reachability.' },
    ],
  },
  {
    code: 'CAMPUS-BOOKING-CONFLICT', title: 'Campus Event and Resource Booking System with Conflict Detection',
    core_concepts: [
      { course: 'Data Structures & Algorithms', concepts: 'Sorted interval list (O(n) overlap); min-heap waitlist; FIFO notifications.' },
      { course: 'Database Management Systems', concepts: 'DB-layer overlap constraint; SERIALIZABLE isolation; atomic waitlist promotion.' },
      { course: 'Operating Systems', concepts: 'Mutex-protected notification thread; race condition with/without SERIALIZABLE isolation.' },
      { course: 'Software Engineering & SDLC', concepts: 'Booking state machine spec first; 4-scenario test plan.' },
      { course: 'Web Technologies & Networks', concepts: 'Full booking API; real-time availability; iCal export.' },
      { course: 'Discrete Mathematics', concepts: 'Interval overlap as formal relation; CSP; waitlist as total order.' },
    ],
  },
];

export function seedFoundationCatalog(db) {
  const upsertGate = db.prepare(
    `INSERT INTO gates (id, sequence, name, marks_weight, stage_range, primary_review_focus, course_outcomes, default_week_number)
     VALUES (@id, @sequence, @name, @marks_weight, @stage_range, @primary_review_focus, @course_outcomes, @default_week_number)
     ON CONFLICT (id) DO UPDATE SET
       sequence = excluded.sequence, name = excluded.name, marks_weight = excluded.marks_weight,
       stage_range = excluded.stage_range, primary_review_focus = excluded.primary_review_focus,
       course_outcomes = excluded.course_outcomes, default_week_number = excluded.default_week_number`,
  );
  // stage_definitions.gate_id was a NOT NULL column in the v1 extension,
  // removed from the v2 schema (a stage can now map to more than one gate -
  // see stage_gate_map). A fresh database never has this column at all; a
  // database that already ran the v1 extension still has it, still NOT
  // NULL, and cannot have that constraint lifted by ALTER TABLE - so the
  // upsert below supplies each stage's first-listed gate (from
  // STAGE_GATE_MAP) for that column only when it still exists, and omits
  // it entirely on a schema where it doesn't.
  const stageDefinitionsHasLegacyGateId = db.prepare('PRAGMA table_info(stage_definitions)')
    .all().some((c) => c.name === 'gate_id');
  const primaryGateByStage = new Map();
  for (const [stageId, gateId] of STAGE_GATE_MAP) {
    if (!primaryGateByStage.has(stageId)) primaryGateByStage.set(stageId, gateId);
  }
  const upsertStage = db.prepare(
    stageDefinitionsHasLegacyGateId
      ? `INSERT INTO stage_definitions
           (id, sequence, name, primary_question, expected_outcome, description, is_sequential_foundation, evidence_checklist, gate_id)
         VALUES (@id, @sequence, @name, @primary_question, @expected_outcome, @description, @is_sequential_foundation, @evidence_checklist, @legacy_gate_id)
         ON CONFLICT (id) DO UPDATE SET
           sequence = excluded.sequence, name = excluded.name, primary_question = excluded.primary_question,
           expected_outcome = excluded.expected_outcome, description = excluded.description,
           is_sequential_foundation = excluded.is_sequential_foundation, evidence_checklist = excluded.evidence_checklist`
      : `INSERT INTO stage_definitions
           (id, sequence, name, primary_question, expected_outcome, description, is_sequential_foundation, evidence_checklist)
         VALUES (@id, @sequence, @name, @primary_question, @expected_outcome, @description, @is_sequential_foundation, @evidence_checklist)
         ON CONFLICT (id) DO UPDATE SET
           sequence = excluded.sequence, name = excluded.name, primary_question = excluded.primary_question,
           expected_outcome = excluded.expected_outcome, description = excluded.description,
           is_sequential_foundation = excluded.is_sequential_foundation, evidence_checklist = excluded.evidence_checklist`,
  );
  const clearStageGateMap = db.prepare('DELETE FROM stage_gate_map');
  const insertStageGateMap = db.prepare('INSERT INTO stage_gate_map (stage_id, gate_id) VALUES (?, ?)');
  const upsertSprint = db.prepare(
    `INSERT INTO sprints (id, sequence, name, stage_range, objective, purpose, closes_gate_id)
     VALUES (@id, @sequence, @name, @stage_range, @objective, @purpose, @closes_gate_id)
     ON CONFLICT (id) DO UPDATE SET
       sequence = excluded.sequence, name = excluded.name, stage_range = excluded.stage_range,
       objective = excluded.objective, purpose = excluded.purpose, closes_gate_id = excluded.closes_gate_id`,
  );
  const upsertCalendarWeek = db.prepare(
    `INSERT INTO calendar_weeks
       (id, academic_year, week_number, start_date, end_date, activity, stage_ids, gate_id, sprint_id, is_protected_week, required_output)
     VALUES (@id, @academic_year, @week_number, @start_date, @end_date, @activity, @stage_ids, @gate_id, @sprint_id, @is_protected_week, @required_output)
     ON CONFLICT (academic_year, week_number) DO UPDATE SET
       start_date = excluded.start_date, end_date = excluded.end_date, activity = excluded.activity,
       stage_ids = excluded.stage_ids, gate_id = excluded.gate_id, sprint_id = excluded.sprint_id,
       is_protected_week = excluded.is_protected_week, required_output = excluded.required_output`,
  );
  const clearRubricCriteria = db.prepare('DELETE FROM gate_rubric_criteria WHERE gate_id = ?');
  const insertRubricCriterion = db.prepare(
    `INSERT INTO gate_rubric_criteria (id, gate_id, sequence, criterion_name, weight_marks, level_descriptors)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const themeExists = db.prepare('SELECT 1 FROM project_themes WHERE code = ?');
  const insertTheme = db.prepare(
    `INSERT INTO project_themes
       (id, institute_id, code, title, academic_subtitle, foundational_courses, core_concepts,
        minimum_evidence, final_artefact_description)
     VALUES (@id, NULL, @code, @title, @academic_subtitle, @foundational_courses, @core_concepts,
             @minimum_evidence, @final_artefact_description)`,
  );

  db.transaction(() => {
    for (const gate of GATES) {
      upsertGate.run({ ...gate, course_outcomes: JSON.stringify(gate.course_outcomes) });
    }
    for (const stage of STAGES) {
      upsertStage.run({
        ...stage,
        description: stage.expected_outcome,
        evidence_checklist: stage.evidence_checklist ? JSON.stringify(stage.evidence_checklist) : null,
        legacy_gate_id: primaryGateByStage.get(stage.id) ?? null,
      });
    }
    clearStageGateMap.run();
    for (const [stageId, gateId] of STAGE_GATE_MAP) insertStageGateMap.run(stageId, gateId);

    for (const sprint of SPRINTS) upsertSprint.run(sprint);

    for (const week of CALENDAR_WEEKS) {
      upsertCalendarWeek.run({
        id: `${ACADEMIC_YEAR}-W${String(week.week).padStart(2, '0')}`,
        academic_year: ACADEMIC_YEAR,
        week_number: week.week,
        start_date: week.start,
        end_date: week.end,
        activity: week.activity,
        stage_ids: JSON.stringify(week.stages),
        gate_id: week.gate,
        sprint_id: week.sprint,
        is_protected_week: week.protected ? 1 : 0,
        required_output: week.output,
      });
    }

    for (const [gateId, criteria] of Object.entries(RUBRIC_CRITERIA_BY_GATE)) {
      clearRubricCriteria.run(gateId);
      criteria.forEach((criterion, index) => {
        insertRubricCriterion.run(
          newId('grc'), gateId, index, criterion.name, criterion.weight,
          criterion.descriptors ? JSON.stringify(criterion.descriptors) : null,
        );
      });
    }

    for (const theme of THEMES) {
      if (!themeExists.get(theme.code)) {
        insertTheme.run({
          id: newId('thm'),
          code: theme.code,
          title: theme.title,
          academic_subtitle: theme.academic_subtitle ?? null,
          foundational_courses: JSON.stringify(SIX_COURSES),
          core_concepts: JSON.stringify(theme.core_concepts),
          minimum_evidence: theme.minimum_evidence ? JSON.stringify(theme.minimum_evidence) : null,
          final_artefact_description: theme.final_artefact_description ?? null,
        });
      }
    }
  })();
}
