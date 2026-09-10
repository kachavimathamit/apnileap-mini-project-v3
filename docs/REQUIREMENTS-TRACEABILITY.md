# Requirements traceability

Maps each clause of *Mini-Project Portfolio Monitoring Portal — Requirements Specification v0.1*
to where it is implemented and how it is verified.

Status key: **Done** · **Partial** (implemented with a stated limitation) · **Deferred** (out of
scope for this release, per the specification's own phasing).

---

## 3. Information hierarchy

| Level | Status | Where |
|---|---|---|
| Programme — authorized institutes and overall status | Done | `GET /api/institutes`, `/institutes/summary`; `pages/PortfolioPage.tsx` |
| Institute — departments, counts, RAG distribution, trends | Done | `GET /api/institutes/:id/dashboard`; `pages/InstitutePage.tsx` |
| Department — projects, mentors, health, milestones, overdue actions | Done | `GET /api/departments/:id`; `pages/DepartmentPage.tsx` |
| Project — definition, team, status, KPIs, challenges, actions, reviews | Done | `GET /api/projects/:id`; `pages/ProjectPage.tsx` |
| Issue/action — cause, impact, owner, due date, evidence, closure | Done | `services/portfolio.js` `projectDetail`; challenges tab |

## 4. Users, roles and decision rights

| Role | Status | Notes |
|---|---|---|
| Platform Administrator | Done | Full capability set; only role that can grant platform scope |
| Global Programme Leader | Done | Per-institute grants, exactly as the "Balaji" example describes |
| Institute Administrator | Done | One institute; may manage its users, departments, projects |
| Dean / Principal | Done | Institute-wide view, review, approve status |
| Department Head | Done | Assigned departments; verify actions; approve status |
| Faculty Mentor | Done | Update, propose status; explicitly cannot approve Red→Green |
| Reviewer / Success Coach | Done | Review, recommend, approve status |
| Read-only Stakeholder | Done | View only; verified by test |
| Student | Done | Project-scoped; may raise challenges (section 2.1) |

Capability matrix: `services/accessScope.js`. Verified by `isolation.test.js`, `workflow.test.js`.

## 5.1 Authentication and account control

| Requirement | Status | Where |
|---|---|---|
| Authenticate before accessing project information | Done | `middleware/authenticate.js` on every non-auth route |
| Email and password login with secure password reset | Done | `routes/auth.routes.js`; bcrypt cost 12; hashed, single-use, one-hour reset tokens |
| MFA mandatory for privileged roles | Deferred | Marked optional for Phase 1 by the specification; `users.mfa_enabled` column reserved |
| Inactive sessions expire after a configurable period | Done | `SESSION_IDLE_MINUTES` sliding timeout + `SESSION_ABSOLUTE_HOURS` cap |
| A deactivated account loses access immediately | Done | `token_version` checked per request; test: *a deactivated account loses access immediately* |
| Architecture permits later SSO | Partial | Auth is isolated behind token issuance; no SSO provider wired |

Additional hardening: account lockout after `LOGIN_MAX_ATTEMPTS`, identical responses for unknown
account / wrong password / deactivated account, and a matched bcrypt work factor on the unknown-account
path so timing does not leak account existence.

## 5.2 Institute selection and landing experience

| Requirement | Status | Where |
|---|---|---|
| Show only authorized institutes | Done | `listInstitutes` with scope predicate; test: *institute listing shows only authorized institutes* |
| Single-institute user goes straight there, sees no other names | Done | `autoSelectInstituteId`; `PortfolioPage` redirects |
| Global user selects among institutes and sees a consolidated view | Done | `/institutes/summary` |
| Landing page shows last refresh, active role and access scope | Done | `GET /api/me`; the scope bar in `Shell.tsx` |

## 5.3 Institute dashboard

Departments and active projects; RAG counts and percentages; projects awaiting review, with overdue
actions, and not recently updated; assistance requests; upcoming milestones. **Done** —
`services/portfolio.js` `instituteDashboard`. A four-week trend is reconstructed from
`status_history`.

## 5.4 Department dashboard

Department identity (name, head, coordinator); portfolio summary; project rows with name, mentor,
RAG, completion, last update, next review and open issues; filters by status, mentor, semester,
academic year, overdue action and last-update date; sorting by severity, oldest update, nearest
milestone, mentor, name and completion; navigation into the project. **Done** —
`departmentDashboard`, `listProjects`, `routes/projectQuery.js`, `pages/DepartmentPage.tsx`.

## 5.5 Project dashboard

| Section | Status | Notes |
|---|---|---|
| Project identity | Done | Code, title, institute, department, year, semester, mentor, team, dates |
| Project definition | Done | All nine fields from the specification, stored and displayed |
| Execution | Done | RAG, completion, milestone states, last and next review |
| KPI evidence | Done | Definition, target, latest measurement, evidence, date, accountable owner |
| Challenges | Done | Issue, root cause, impact, assistance, owner, due date, escalation, evidence |
| Review history | Done | Previous status, new status, reviewer, date, comments, decision, corrective action |
| Links | Done | Repository links and attachment metadata; storage itself is Phase 3 |

## 5.6 Red-project intervention workflow

| Step | Status | Where |
|---|---|---|
| 1. Why Red, and since when | Done | Intervention panel on `ProjectPage`, from `rag_status_since` and history |
| 2. Blocker, root cause, impact | Done | `issues` table; required fields on the form |
| 3. Corrective actions attempted, evidence | Done | `corrective_actions`, `issues.evidence` |
| 4. Support required and from whom | Done | `assistance_required` + `support_source` |
| 5. Owner, target date, escalation owner, next review | Done | `corrective_actions`, `projects.next_review_date` |
| 6. No Green without evidence and reviewer approval | Done | `evaluateStatusTransition`; four tests in `workflow.test.js` |

## 5.7 Status history and review control

| Requirement | Status | Where |
|---|---|---|
| Preserve previous status, new status, user, timestamp, rationale | Done | `status_history`, written in the same transaction as the change |
| History preserved even when archived | Done | Archiving sets `is_archived`; history is never deleted |
| Reviewers can request evidence or return an update | Done | Review decisions `EVIDENCE_REQUESTED` / `CHANGES_REQUESTED` |
| Records show last update and next scheduled review | Done | `last_update_at`, `next_review_date` on every project row |

Append-only enforcement is a database trigger — test: *status history is append-only*.

## 6. RAG status model

Definitions, criteria and required response for each status live in `services/rag.js` and are served
to the client via `/api/me`, so every institute renders identical wording. **Done.**
`recommendStatus` provides the advisory algorithmic recommendation the specification anticipates,
explicitly non-binding.

## 7. Security, privacy and tenant isolation

| Control domain | Status | Notes |
|---|---|---|
| Identity | Done | Unique accounts, bcrypt, immediate revocation. MFA deferred (5.1) |
| Authorization | Done | Role and institute scope checked per request; deny by default (`1 = 0`) |
| Tenant isolation | Done | `institute_id` on every owned row; scope predicate in every read |
| Transport | Deferred to deployment | `COOKIE_SECURE`, HSTS via Helmet; TLS terminates at the reverse proxy |
| Data at rest | Deferred to deployment | Filesystem/volume encryption; no application-layer encryption |
| Audit | Done | Logins, denials, views, edits, exports, status changes — append-only |
| Application protection | Done | Zod validation, parameterised queries, Helmet, origin check, rate limiting |
| Backup/recovery | Partial | Documented procedure; no scheduled job |
| Exports | Done | Scope-limited and audited (`WEEKLY_REPORT_EXPORTED`) |

**Mandatory test.** *"If a KLE user changes a URL, request parameter or project ID to one belonging
to another institute, the backend must reject the request and create an audit event."* — automated in
`server/test/isolation.test.js`, covering institute dashboards, department reads, project reads,
history reads, issue creation and status changes. Each attempt asserts a `404`, asserts the other
institute's name never appears in the response, and asserts one `CROSS_TENANT_ACCESS_DENIED` audit
event per attempt.

## 8. Data architecture and storage

Relational database as the operational store; GitHub for code; object storage for large files;
links held in the database. **Done** as a design; object storage is modelled but not hosted.
All 14 core entities from section 8.1 exist in `schema.sql`.

## 9. Notifications and weekly reporting

| Event | Status |
|---|---|
| Project changes to Red | Done |
| Project moves from Red to Yellow or Green | Done |
| Corrective action becomes overdue | Done (hourly sweep) |
| Scheduled review approaching | Done (hourly sweep) |
| Project not updated within the defined interval | Done (hourly sweep) |
| Mentor requests support | Done |
| Administrator changes a user's access rights | Done |

Delivery is in-app; the section marks event notifications optional for Phase 1. The **weekly
management report** (9.2) is Done: institute-wise RAG and trend, new and long-standing Red,
recovering projects, overdue actions, stale updates, upcoming reviews and milestones, and assistance
requests — all built per recipient from that recipient's scope. Test: *the weekly report is scoped to
each recipient*.

## 10. API and interface requirements

Every representative endpoint in the specification exists, plus the endpoints needed for the
workflow. All perform authentication, authorization, tenant-scope enforcement, input validation and
audit logging, and responses do not reveal whether an unauthorized record exists.

| Specified endpoint | Implemented as |
|---|---|
| `POST /login` | `POST /api/auth/login` |
| `GET /institutes` | `GET /api/institutes` |
| `GET /institutes/{id}/dashboard` | same |
| `GET /institutes/{id}/departments` | same |
| `GET /departments/{id}/projects` | same (plus `GET /api/departments/{id}`) |
| `GET /projects/{id}` | same |
| `POST/PATCH /projects` | `POST /api/projects`, `PATCH /api/projects/{id}` |
| `POST /projects/{id}/status` | same |
| `POST /projects/{id}/issues` | same (plus `PATCH .../issues/{id}`) |
| `POST /projects/{id}/actions` | same (plus `PATCH .../actions/{id}`) |
| `POST /projects/{id}/reviews` | same |
| `GET /projects/{id}/history` | same |
| `GET /reports/weekly` | same (plus `.csv` and `.html`) |

## 11. Non-functional requirements

| Attribute | Status | Notes |
|---|---|---|
| Usability | Done | Responsive layout; plain language aimed at non-technical faculty |
| Performance | Done | Indexed queries, single round trip per dashboard; well within three seconds at pilot scale |
| Availability | Deferred to deployment | Single-node pilot; the schema is portable for HA |
| Scalability | Done | Adding institutes is data, not code; no hard-coded institute logic |
| Accessibility | Done | Colour plus shape plus letter plus text on every status; ARIA labels; skip link |
| Maintainability | Done | Institutes, departments, roles, thresholds and intervals are configuration |
| Auditability | Done | Append-only history and audit; scoped audit export |
| Backup | Partial | Documented procedure, not automated |
| Portability | Done | CSV (Excel) and print-ready HTML for PDF |
| Observability | Partial | `/api/health`, structured error logging, audit events; no metrics exporter |

## 12. Minimum viable product

| # | Item | Status |
|---|---|---|
| 1 | Secure login and account administration | Done |
| 2 | Role-based and institute-scoped authorization | Done |
| 3 | Institute selection and institute summary | Done |
| 4 | Department selection and project listing | Done |
| 5 | Green/Yellow/Red status with accessible labels | Done |
| 6 | Project-detail page with milestone, KPI, issue and action information | Done |
| 7 | Red-project challenge and corrective-action workflow | Done |
| 8 | Review and status history | Done |
| 9 | Weekly authorized email summary | Done (console transport by default; SMTP configurable) |
| 10 | Security and activity audit logging | Done |

## 13. MVP acceptance criteria

| Criterion | Status | Verified by |
|---|---|---|
| Global user sees every explicitly assigned institute | Done | `isolation.test.js` |
| Institute user sees only the assigned institute | Done | `isolation.test.js` |
| Department user sees only assigned departments and projects | Done | `isolation.test.js` |
| URL or identifier manipulation cannot expose another institute's record | Done | `isolation.test.js` (mandatory test) |
| Selecting an institute displays its authorized departments | Done | `InstitutePage` |
| Selecting a department displays its authorized projects | Done | `DepartmentPage` |
| Every project row shows name, mentor, status and last-update date | Done | `DepartmentPage` |
| A Red project shows issue, impact, required support, owner and target date | Done | `ProjectPage` challenges tab |
| Every status transition is preserved in review and audit history | Done | `workflow.test.js` |
| A Red project cannot return to Green without evidence and approval | Done | four tests in `workflow.test.js` |
| Weekly reports include only the recipient's authorized scope | Done | `reporting.test.js` |
| Authorized users can access the portal securely from outside the network | Deferred to deployment | Standard web deployment behind TLS |
| Backup restoration and account revocation are demonstrated | Partial | Revocation tested; backup restoration is an operational drill |

## 14. Delivery phases

- **Phase 1 — Foundation:** identity, roles, institute isolation, hierarchy, project records, RAG
  status, audit logging. **Complete.**
- **Phase 2 — Intervention:** issues, corrective actions, review workflow, notifications, weekly
  reports. **Complete.**
- **Phase 3 — Integration:** repository links present as stored URLs; document storage, SSO and
  export integration remain.
- **Phase 4 — Intelligence:** stale-project detection is implemented and the advisory status
  recommendation exists; trend analytics and cross-institute learning remain.
