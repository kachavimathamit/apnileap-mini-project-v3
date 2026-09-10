# Architecture

## Shape

```
Browser (React + TypeScript, Vite)
   │  same-origin fetch, httpOnly session cookie
   ▼
Express API  ──►  authenticate  ──►  resolve scope  ──►  authorize record  ──►  handler
   │                                      │                                        │
   │                                      └── SQL scope predicate ────────────────►│
   ▼                                                                               ▼
SQLite (relational, WAL)                                                    append-only audit
```

The web app talks to `/api` on its own origin (Vite proxies to port 4000 in development, a reverse
proxy does the same in production). The session cookie is therefore first-party, `httpOnly`,
`SameSite=Lax`, and `Secure` when `COOKIE_SECURE=true`.

## Why a relational database

Section 8 of the requirements is explicit that Git is not the operational database, and the reasons
given — dashboard queries, transactional updates, row-level tenant isolation — are exactly what
drove the schema. Three stores, each doing what it is good at:

| Store | Holds | Why |
|---|---|---|
| Relational database | Users, grants, institutes, departments, projects, status, KPIs, issues, actions, reviews, audit | Transactional integrity, querying, row-level control |
| Private GitHub repositories | Source code and versioned engineering documents | Engineering collaboration and controlled versioning |
| Object storage | Presentations, reports, images, recordings | Scalable file storage with signed, authorized access |

The portal stores only *links* to the second and third — `repository_links` and `attachments` — so
the dashboard stays queryable while the artefacts stay in the systems designed for them.

SQLite was chosen for the pilot: one file, no server to operate, real SQL with foreign keys,
triggers and transactions. The schema uses no SQLite-specific types and is written to move to
PostgreSQL when the deployment needs more than one node.

## The authorization model

This is the part of the system that matters most, so it is worth stating precisely.

A user holds zero or more **access grants**. Each grant is a `(role, scope)` pair:

| Scope type | Covers |
|---|---|
| `PLATFORM` | The whole deployment (platform administrator only) |
| `INSTITUTE` | One institute and everything inside it |
| `DEPARTMENT` | One department and its projects |
| `PROJECT` | A single project |

A database `CHECK` constraint requires the scope target to match the scope type, so a malformed
grant cannot silently widen access.

`services/accessScope.js` turns a user's grants into three things:

1. **A capability set** — roles map to permissions (`project:view`, `status:approve`,
   `action:verify`, `user:manage`, …) and permissions are additive across roles.
2. **SQL predicates** — `instituteScopeSql`, `departmentScopeSql` and `projectScopeSql` return a
   `WHERE` fragment plus bound parameters. Every read composes one. A user with no relevant grant
   gets `1 = 0`, not an empty filter.
3. **Per-record roles** — a user may be an Institute Administrator at KLE and only a mentor on one
   RIT project. `rolesForProject` resolves the roles that apply to *the record being touched*, so
   capability checks are never evaluated against the wrong scope.

### Why the same 404 for "missing" and "forbidden"

Section 10 requires that responses do not reveal whether an unauthorized record exists. The resource
loaders in `middleware/authorize.js` run the lookup *with* the scope predicate; if that returns
nothing they check whether the row exists at all. Either way the caller receives an identical
`404 NOT_FOUND`. The difference is recorded where it belongs — in the audit log, as
`CROSS_TENANT_ACCESS_DENIED` with the real institute id.

### Notifications use the same rule

`recipientsForProject` resolves recipients by joining the *same* grant conditions used for reads. A
notification therefore cannot carry information to somebody who is not authorized to see the
underlying project — the delivery list is a consequence of the access model, not a parallel one.

## Status governance

`services/rag.js` holds both the RAG definitions and the transition rules, in one place, so the
definitions stay identical across institutes as section 6 requires.

`evaluateStatusTransition` returns a verdict rather than throwing, so a refusal can be audited
before it is returned. The rule that matters:

```
RED ──► GREEN  requires  status:approve            (a mentor cannot)
                    AND  evidence ≥ 20 characters
                    AND  no open HIGH/CRITICAL challenge
                    AND  no overdue corrective action
```

Raising an alarm is deliberately unobstructed — moving *into* Red needs only the mandatory
rationale. Making a problem disappear is what requires proof.

Two related separations of duty:

- Closing a challenge (`RESOLVED` / `VERIFIED` / `CLOSED`) requires evidence.
- Verifying a corrective action requires `action:verify`, which mentors do not hold — so the person
  who did the work is not the person who certifies it.

`recommendStatus` computes an advisory RAG from milestones, KPIs, open work and staleness. It is
shown beside the declared status and never overrides it: as the specification puts it, the
responsible human remains accountable for approval. This is the seam where Phase 4's automated
recommendation will attach.

## Immutability

Two tables are append-only, enforced by `BEFORE UPDATE` / `BEFORE DELETE` triggers in
`schema.sql` rather than by application discipline:

- `status_history` — every status change with its previous value, author, timestamp, rationale,
  evidence and approver.
- `audit_log` — logins, failed authorization, views of sensitive records, edits, exports and status
  changes.

`status_history` permits deletion only when its parent project row is already gone, so cascading a
project delete still works while ordinary deletion does not.

## Sessions

Stateless JWTs in an httpOnly cookie, carrying three time-related claims:

- `iat` drives a **sliding idle timeout** (`SESSION_IDLE_MINUTES`); the cookie is reissued on each
  authenticated request, so an idle session expires on schedule.
- `sessionStart` caps the **absolute lifetime** regardless of activity.
- `tokenVersion` is compared against the user row on every request, so deactivating an account,
  resetting a password or changing a password revokes every outstanding session immediately —
  the requirement that "a deactivated account shall lose access immediately", without server-side
  session storage.

The architecture leaves room for the Microsoft / Google / institute SSO integration named in
section 5.1: authentication produces a user id and a token version, and nothing downstream cares how
that identity was established.

## Readability and accessibility

The interface is aimed at non-technical faculty users reading dashboards on whatever screen is to
hand, sometimes projected in a review meeting. Readability is therefore treated as a requirement
rather than a preference, and the rules live in one place — `web/src/styles.css`.

**A fluid type scale, with a floor.** Sizes are `clamp()` tokens (`--fs-caption` through
`--fs-display`), so text adapts to the viewport instead of every element being scaled uniformly.
Nothing in the interface renders below 15px, and body text and table data sit at 16–18px.

**Everything sizes in rem, and the root is never a fixed pixel value.** Both browser zoom and a
raised default font size scale the whole interface. Verified at a 24px root on a 375px-wide viewport
with no overflow, clipping or sideways page scroll.

**Interactive elements are at least 44px** on their smallest axis — buttons, inputs, selects, tabs and
navigation items. Checkboxes are 20px but their wrapping `<label>` is a full 44px target. Standalone
links get a full-size target too; links inside a sentence keep their natural inline size.

**Status never depends on colour.** Every RAG indicator renders four signals at once: a colour, a
distinct shape (circle / square / triangle), a letter (G / Y / R), and the full text label. Table
headers are distinguished from data by weight, case, colour *and* a shaded band, not by size alone.
Proportion bars carry an `aria-label` describing the distribution in words.

**Contrast meets WCAG AA** for every text/background pair in use; the lightest permitted text colour
(`--ink-faint`) is 4.9:1 on white. Hover, focus and active states are defined for every interactive
element, with a 3px high-contrast focus ring and a `@supports` fallback for engines lacking
`:focus-visible`.

**Wide content scrolls inside its own container.** Tables sit in an `overflow-x: auto` wrapper, so a
five-column table on a phone scrolls locally and never drags the page sideways.

The result stays readable in greyscale, in print, and for colour-blind users.

## Testing

26 tests across three files, covering the parts where a silent regression would be most damaging:

- `isolation.test.js` — the mandatory cross-tenant test from section 7, in both read and write
  directions, plus department-scoped and project-scoped visibility, and immediate revocation.
- `workflow.test.js` — the Red-to-Green governance rules end to end, append-only enforcement,
  student and read-only restrictions, and separation of duty on verification.
- `reporting.test.js` — per-recipient report scoping, audited exports, audit-trail scoping, and the
  privilege-escalation paths an institute administrator must not have.

Each file seeds its own database file, because `node --test` runs test files in parallel.
