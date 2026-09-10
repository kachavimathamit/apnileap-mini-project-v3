# System Design Document

**Mini-Project Portfolio Monitoring Portal**
ApniLeap mini-project programme · Version 0.1 · Phase 1 (Foundation) + Phase 2 (Intervention), MVP complete

---

## 1. Purpose and scope

This document describes the technical design of the Mini-Project Portfolio Monitoring Portal: a
secure, multi-institute web application that gives programme leaders, institute administrators,
department heads, faculty mentors, reviewers and students a shared, access-controlled view of
mini-project execution — status, milestones, KPIs, challenges, corrective actions and review
history — across five participating institutes (KLE, MMCOE, RIT, COEP and Sangli).

It implements the MVP defined in the requirements specification (§12) and the §13 acceptance
criteria, corresponding to delivery Phases 1 (Foundation) and 2 (Intervention). The system provides
full CRUD (create, read, update, delete) across every entity in the hierarchy — institutes,
departments, projects, milestones, KPIs, team members, repository links, documents, user accounts
and access grants — subject to the role and scope of the acting user.

The companion documents [`ARCHITECTURE.md`](ARCHITECTURE.md), [`API.md`](API.md) and
[`REQUIREMENTS-TRACEABILITY.md`](REQUIREMENTS-TRACEABILITY.md) go deeper on the authorization model,
the endpoint contract and the clause-by-clause mapping to the specification, respectively. This
document is the single entry point that ties those views together for a reader encountering the
system for the first time.

**Non-goals (by design).** Automatic grading, public project discovery, replacing GitHub, and
AI-based success prediction are explicitly out of scope for this release, per §2.2 of the
specification.

---

## 2. Design goals and constraints

| Goal | How it shapes the design |
|---|---|
| **Institutional data isolation is a data-layer property, not a UI convention.** | Every read composes a SQL scope predicate derived from the caller's access grants. There is no code path that fetches unscoped data and filters it afterward. |
| **A Red project must not quietly return to Green.** | The status-transition rule is centralized in one service (`services/rag.js`) and evaluated server-side on every attempt, never trusted from the client. |
| **Every material change is traceable.** | `status_history` and `audit_log` are database tables with `BEFORE UPDATE`/`BEFORE DELETE` triggers that raise an error — immutability is enforced by SQLite itself, not by application discipline. |
| **The system must run on a single machine for a pilot, without a database server to operate.** | SQLite (WAL mode) as the operational store. The schema uses only portable SQL, so a move to PostgreSQL for a multi-node deployment requires no redesign. |
| **Non-technical faculty users must be able to use it comfortably.** | Server-rendered validation with plain-language error messages; a responsive, accessible front end where status is never conveyed by colour alone. |
| **The interface must not offer an action the server would refuse.** | Every list/detail response includes a `permissions` array computed from the caller's actual grants; the UI conditionally renders forms and buttons from that array. The server re-checks independently on every write — the client array is a UX hint, never the authorization boundary. |

---

## 3. High-level architecture

```
                         ┌─────────────────────────────┐
                         │   Browser (React + TS)      │
                         │   Vite dev server / static    │
                         │   build for production        │
                         └───────────────┬─────────────┘
                                         │ same-origin fetch
                                         │ httpOnly session cookie
                                         ▼
                         ┌─────────────────────────────┐
                         │        Express API           │
                         │  helmet · cors · rate-limit   │
                         └───────────────┬─────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
┌───────────────┐              ┌───────────────────┐            ┌──────────────────┐
│ authenticate   │   ──────►    │ resolve scope       │  ──────►  │ authorize record   │
│ (session cookie,│              │ (grants → SQL       │            │ (load with scope   │
│  token version) │              │  predicates +        │            │  predicate; same    │
│                 │              │  permission set)      │            │  404 if outside it) │
└───────────────┘              └───────────────────┘            └────────┬──────────┘
                                                                          ▼
                                                                 ┌──────────────────┐
                                                                 │  route handler     │
                                                                 │  (validate → write  │
                                                                 │   → audit → notify) │
                                                                 └────────┬──────────┘
                                                                          ▼
                                                                 ┌──────────────────┐
                                                                 │ SQLite (WAL)       │
                                                                 │ append-only         │
                                                                 │ status_history,      │
                                                                 │ audit_log            │
                                                                 └──────────────────┘
```

The web app and API are two Node.js processes. In development, Vite proxies `/api` to port 4000 so
the browser sees a single origin; in production the same origin relationship holds behind a reverse
proxy, keeping the session cookie strictly first-party.

**Three data stores by design**, per §8 of the specification — Git is explicitly not the operational
database:

| Store | Holds | Why |
|---|---|---|
| SQLite (this system) | Users, grants, institutes, departments, projects, milestones, KPIs, issues, actions, reviews, audit | Transactional writes, row-level scope filtering, real joins for dashboards |
| Private GitHub repositories | Source code, versioned documents | Purpose-built for code collaboration; not replaced |
| Object storage (external, referenced) | Reports, presentations, images, recordings | Scalable file storage with signed access; the portal stores only the link and metadata |

---

## 4. Component design

### 4.1 Backend layout

```
server/src/
  config.js              Environment configuration, one validated object
  app.js                 Express app: middleware chain, route mounting
  index.js               Process entry point, hourly notification sweep
  db/
    schema.sql            Full relational schema + append-only triggers
    connection.js          better-sqlite3 connection, WAL, migrate()
    seed.js / reset.js     Demonstration data lifecycle
  auth/
    password.js            bcrypt hashing, password policy
    tokens.js               JWT issue/verify, idle + absolute session limits
  middleware/
    authenticate.js         Session → req.user, req.scope
    authorize.js             Scoped record loaders; permission gates
    validate.js               Zod schema → req.valid
    errors.js                  Typed HttpError, uniform error envelope
  services/
    accessScope.js           THE authorization model (see §5)
    rag.js                    RAG definitions + status-transition rules
    portfolio.js              Scoped dashboard/list queries
    report.js                 Per-recipient weekly report + exports
    notifications.js          Event + time-based notification sweep
    audit.js                  Append-only audit writer
    mailer.js                 Console or SMTP transport
  routes/
    auth.routes.js            login, logout, password reset/change
    me.routes.js               session info, notifications
    institutes.routes.js       institute list/dashboard (read)
    departments.routes.js      department CRUD + project list
    projects.routes.js         project CRUD + every child entity's CRUD
    admin.routes.js            institute/user/grant CRUD, audit trail
    reports.routes.js          weekly report (JSON/CSV/HTML)
```

Each route file is a thin HTTP adapter: validate input → call a scoped loader or service → write →
audit → respond. Business rules (status governance, scope resolution) live in `services/`, not in
route handlers, so they are unit-testable independent of HTTP.

### 4.2 Frontend layout

```
web/src/
  api.ts                 Typed fetch client + response shapes (single source of truth)
  session.tsx             React context: current user, permissions, sign-in/out
  App.tsx / Shell.tsx      Routing + persistent shell (nav, scope bar)
  pages/                   One page per level of the hierarchy + admin/report/audit
  components/
    ui.tsx                  Status badges, cards, tables, accessible primitives
    ProjectForm.tsx          Create/edit project definition
    ExecutionForms.tsx       Milestones + KPIs + measurements (CRUD)
    TeamArtefactForms.tsx    Team members, repository links, documents (CRUD)
    IssueForms.tsx           Challenges + corrective actions (CRUD)
    StatusChangeForm.tsx     RAG transition, with governance messaging
    ReviewForm.tsx           Review recording
```

Pages fetch through `api.ts`, never `fetch()` directly, so every response is typed once. Each
page/detail response carries a `permissions` array; components read it to decide which create-edit
-delete affordances to render, keeping the UI declarative rather than duplicating role logic.

---

## 5. Authorization model (the core design decision)

Every other design choice in this system is downstream of one idea: **authorization is data, not
code branches.**

A user holds zero or more **access grants**, each a `(role, scope)` pair:

| Scope type | Grants access to |
|---|---|
| `PLATFORM` | Everything (platform administrator only) |
| `INSTITUTE` | One institute and everything under it |
| `DEPARTMENT` | One department and its projects |
| `PROJECT` | One project |

A `CHECK` constraint on `access_grants` enforces that the scope columns match the scope type, so a
malformed row cannot silently widen access.

`services/accessScope.js` turns a user's grants (loaded once per request) into:

1. **SQL predicates** — `instituteScopeSql`, `departmentScopeSql`, `projectScopeSql` each return a
   `WHERE` fragment plus bound parameters. A user with no relevant grant gets `1 = 0`. Every list
   and detail query in `services/portfolio.js` composes one of these; there is no unscoped query
   anywhere in the codebase that returns project or institute data.
2. **A permission set** — roles map to capability strings (`project:view`, `project:create`,
   `status:approve`, `action:verify`, `user:manage`, …), additive across every grant the user holds.
3. **Per-record roles** — `rolesForProject(scope, project)` resolves which of the user's grants
   actually apply to *this* record, so a user who is an Institute Administrator at KLE and only a
   mentor on one RIT project is evaluated correctly regardless of which project they touch.

**Why a record outside scope returns 404, not 403.** §10 of the specification requires that API
responses not reveal whether an unauthorized record exists. The loaders in `middleware/authorize.js`
query *with* the scope predicate; if nothing comes back, they separately check whether the row
exists at all — and return the identical `404 NOT_FOUND` either way. The real reason is written to
`audit_log` as `CROSS_TENANT_ACCESS_DENIED`, with the institute id, so administrators can see the
attempt without the caller ever learning it.

This is exercised directly by the mandatory test in §7 of the specification (`test/isolation.test.js`):
a KLE user who edits a URL or identifier to reach an MMCOE project is refused on every verb — GET,
POST, PATCH, DELETE — and each refusal is independently audited.

---

## 6. Data model

18 tables, organized in five groups (full DDL in `server/src/db/schema.sql`):

```
institutes ──< departments ──< projects ──< milestones
     │              │              │  ├──< kpis ──< kpi_measurements
     │              │              │  ├──< issues ──< corrective_actions
     │              │              │  ├──< reviews
     │              │              │  ├──< status_history   (append-only)
     │              │              │  ├──< project_members
     │              │              │  ├──< repository_links
     │              │              │  └──< attachments
     │              │              │
     └──< access_grants >── users ─┘
                                │
                                ├──< password_reset_tokens
                                └──< notifications

audit_log            (append-only, references users/institutes loosely by id)
```

**Key design choices:**

- Every institute-owned row carries `institute_id` directly (not derived through a join), so the
  scope predicate can filter any table in one step without traversing the hierarchy at query time.
- `access_grants`, `status_history` and `corrective_actions` all reference `users` for
  accountability — who granted access, who changed a status, who owns and who verifies an action —
  because "who is accountable" is a first-class requirement (§5.6), not an afterthought.
- **Separation of duty is structural.** Verifying a corrective action requires the `action:verify`
  permission, which the `FACULTY_MENTOR` role does not hold — so the schema and the role matrix
  jointly prevent the person who did the work from certifying it complete.
- `status_history.previous_status`/`new_status`, `changed_by`, `rationale`, `evidence` and
  `approved_by` sit on one row per transition, so the full audit trail of *why* a project moved is
  reconstructible without joining anything else.
- Student names are optional: `project_members.team_identifier` is always required for a student
  row, `display_name` is not — reflecting the open stakeholder decision in §15 by defaulting to the
  more private option rather than blocking on it.

**Immutability by trigger, not convention:**

```sql
CREATE TRIGGER status_history_no_update BEFORE UPDATE ON status_history
BEGIN SELECT RAISE(ABORT, 'status_history is append-only'); END;
```

The same pattern guards `audit_log`. This means even a bug in application code, or a future
developer using the database directly, cannot rewrite history — SQLite refuses the statement.

---

## 7. Core workflows

### 7.1 Request lifecycle

Every authenticated request passes through the same pipeline, in this order:

1. **`authenticate`** — verifies the session JWT from the httpOnly cookie, checks the account is
   still active, and compares `token_version` against the database row so a deactivated account or
   a changed password invalidates every outstanding session immediately (no server-side session
   store needed).
2. **`refreshSession`** — slides the idle timeout forward on activity.
3. **Scope resolution** — `req.scope` is computed once and attached to the request.
4. **Record loader** (`withProject` / `withInstitute` / `withDepartment`) — loads the target record
   *with* the scope predicate applied; 404s identically whether missing or out of scope.
5. **Permission gate** (`requireProjectPermission`, etc.) — checks the specific capability needed for
   this write; denials are audited.
6. **Validation** (`validate(zodSchema)`) — input is type-checked and coerced before the handler
   ever sees it.
7. **Handler** — performs the write (often in a `db.transaction()`), touches `last_update_at`,
   writes to `status_history`/`audit_log` as appropriate, and may call `notifications.js`.

### 7.2 CRUD coverage

Every entity in the hierarchy supports the full CRUD lifecycle, gated by the permission matrix:

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| Institute | ✅ platform admin | ✅ scoped | ✅ platform admin | ✅ platform admin (soft-delete if it has departments) |
| Department | ✅ `department:manage` | ✅ scoped | ✅ rename/reassign head | ✅ hard-delete if empty, else deactivated |
| Project | ✅ `project:create` | ✅ scoped | ✅ `project:update` (identity + full definition) | ✅ archive (soft) |
| Milestone | ✅ | ✅ | ✅ status/date | ✅ |
| KPI + measurement | ✅ | ✅ | — (measurements are append-only evidence) | ✅ KPI; measurements are immutable once evidenced |
| Team member | ✅ | ✅ | — | ✅ (soft, `is_active`) |
| Repository link / attachment | ✅ | ✅ | — | ✅ |
| Issue (challenge) | ✅ `issue:create` (incl. students) | ✅ | ✅ `issue:update`, evidence-gated close | — (closed, not deleted — audit trail) |
| Corrective action | ✅ `action:create` | ✅ | ✅ `action:update`; `VERIFIED` needs `action:verify` | — (cancelled, not deleted) |
| Review | ✅ `review:create` | ✅ | — | — (append-only) |
| Status | ✅ (a transition *is* the record) | ✅ | — | — (append-only) |
| User account | ✅ `user:manage` | ✅ scoped | ✅ activate/deactivate/reset | ✅ (only if grants are entirely within the caller's institutes) |
| Access grant | ✅ | ✅ | — | ✅ (soft, `is_active = 0`) |

Deliberate deviations from literal delete: **status history, audit log, reviews and measurements are
never deletable**, because they are the evidentiary record the specification requires. Issues and
corrective actions are closed/cancelled rather than removed, for the same reason — a resolved
challenge is still part of the project's history.

### 7.3 The Red→Green governance rule

The single most safety-critical workflow. `services/rag.js::evaluateStatusTransition` returns a
verdict object rather than throwing, so a refusal can be audited with its specific reason code
before the HTTP response is built:

```
RED → GREEN requires, all four:
  1. the caller holds status:approve           (a Faculty Mentor does not)
  2. evidence text ≥ 20 characters
  3. zero open HIGH/CRITICAL challenges
  4. zero overdue corrective actions
```

Moving a project *into* Red requires only the standard rationale (≥10 characters) — raising an
alarm is never obstructed; only escaping one requires proof. This asymmetry is intentional and is
covered by four dedicated tests.

### 7.4 Weekly reporting

`services/report.js::buildWeeklyReport(scope)` takes a caller's resolved scope and runs entirely
scoped queries — there is no "full report, trimmed afterward" step. `dispatchWeeklyReports()`
iterates every user holding `report:view`, builds *their own* report from *their own* scope, and
mails it. Two recipients of the "same" weekly report literally receive different data. Exports
(CSV, print-ready HTML for PDF) reuse the identical scoped builder and are individually audited as
`WEEKLY_REPORT_EXPORTED`.

---

## 8. Security design

| Control | Implementation |
|---|---|
| Password storage | bcrypt, cost factor 12 |
| Session | httpOnly, `SameSite=Lax` JWT cookie; sliding idle timeout + absolute cap; `token_version` revocation |
| Account lockout | 5 failed attempts → 15-minute lock (configurable) |
| Timing safety | A bcrypt comparison runs even for unknown emails, so login timing does not reveal account existence |
| CSRF | `SameSite=Lax` cookie + explicit origin check on every state-changing request |
| Input validation | Zod schema on every endpoint that accepts a body |
| SQL injection | `better-sqlite3` prepared statements exclusively; no string-built SQL with user input |
| Headers | Helmet: CSP, `frameAncestors: 'none'`, cross-origin resource policy |
| Rate limiting | Global `/api` limiter + a stricter one on `/auth/login` |
| Tenant isolation | SQL scope predicate on every read; identical-404 on cross-tenant access; audited |
| Audit trail | Append-only (`audit_log`), captures actor, action, entity, outcome, IP, detail |
| Separation of duty | `action:verify` withheld from `FACULTY_MENTOR` |

---

## 9. Non-functional design

- **Performance.** Scope predicates filter at the SQL layer using indexed columns
  (`institute_id`, `department_id`, `project_id` all indexed); dashboards are single round trips.
  Comfortably within the 3-second target at pilot scale (10 projects, 5 institutes; indexes make
  this hold at 100×–1000× that volume before requiring query changes).
- **Scalability.** Institutes and departments are configuration rows, not code. Onboarding a sixth
  institute is an `INSERT`, not a deployment.
- **Accessibility.** Every RAG status carries colour + shape (circle/square/triangle) + letter + text
  label — never colour alone. All interactive elements meet a 44px minimum target; type scale is
  fluid (`clamp()`), scales correctly under browser zoom and a raised OS font size, verified down to
  a 375px viewport with a 24px root font and no horizontal overflow.
- **Portability.** No SQLite-specific SQL beyond `datetime()`/`julianday()`; the schema is a
  straightforward PostgreSQL port when the pilot outgrows a single node.
- **Testability.** 43 automated tests across four files (`isolation`, `workflow`, `reporting`,
  `crud`), each seeding its own database so `node --test`'s parallel execution never races.

---

## 10. What is intentionally deferred

Stated explicitly so they read as scoped-out, not missed:

- **MFA** — marked optional for Phase 1 by the specification; `users.mfa_enabled` column reserved.
- **SSO** — authentication is isolated behind token issuance, so a Microsoft/Google/institute SSO
  provider can be added without touching authorization.
- **Object storage integration** — attachments store a link/key today; wiring to signed S3-style
  URLs is Phase 3.
- **Automated status recommendation as the system of record** — `recommendStatus()` exists as an
  advisory signal only; a human remains accountable for the recorded status, per the specification's
  own governance note.
- **Multi-node deployment** — SQLite is correct for a pilot; PostgreSQL is the designed migration
  path when concurrent write volume or high availability requires it.

---

## 11. Summary

The design centers on one enforceable guarantee — **a user can only ever see or change what their
access grants say they can** — and builds outward from it: the SQL predicate that makes isolation a
data-layer property, the append-only triggers that make the audit trail tamper-evident, and the
Red→Green rule that makes "this project has recovered" require proof rather than assertion. Full
CRUD exists across every entity in the hierarchy, and every one of those operations passes through
the same authenticate → scope → authorize → validate → audit pipeline, so the guarantee holds
uniformly rather than depending on each route remembering to re-implement it.
