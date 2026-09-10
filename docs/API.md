# API reference

Base path `/api`. All responses are JSON unless stated otherwise.

Authentication is a `httpOnly` cookie (`mpp_session`) set by `POST /api/auth/login`. Every endpoint
below except those under `/api/auth` requires it, and every one of them performs authentication,
authorization, tenant-scope enforcement, input validation and audit logging.

## Errors

```json
{ "error": { "code": "FORBIDDEN", "message": "…", "details": [ { "field": "…", "message": "…" } ] } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Validation failure, or a workflow precondition stated in `message` |
| 401 | `UNAUTHENTICATED` | No session, expired session, or a revoked account |
| 403 | `FORBIDDEN` | Authenticated, but the role does not permit this action |
| 404 | `NOT_FOUND` | The record does not exist **or** is outside your scope — deliberately indistinguishable |
| 409 | `CONFLICT` | Duplicate code, or a status transition blocked by open work |
| 429 | `RATE_LIMITED` | Too many requests |

## Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | `{ email, password }`. Rate limited; failures are audited and identical for unknown/wrong/deactivated |
| `POST` | `/auth/logout` | Clears the session cookie |
| `POST` | `/auth/password-reset/request` | `{ email }`. Always returns the same message, so accounts cannot be enumerated |
| `POST` | `/auth/password-reset/confirm` | `{ token, newPassword }`. Revokes all existing sessions |
| `POST` | `/auth/change-password` | `{ currentPassword, newPassword }`. Revokes other sessions, reissues yours |

## Session and alerts

| Method | Path | Returns |
|---|---|---|
| `GET` | `/me` | User, roles, permissions, scope description, grants, RAG definitions, last data refresh, unread count |
| `GET` | `/me/notifications?unread=true` | Alerts within scope |
| `POST` | `/me/notifications/read` | `{ ids? }` — omit `ids` to mark all read |

## Portfolio

| Method | Path | Returns |
|---|---|---|
| `GET` | `/institutes` | Authorized institutes, plus `autoSelectInstituteId` when there is exactly one |
| `GET` | `/institutes/summary` | Programme roll-up across authorized institutes |
| `GET` | `/institutes/:id/dashboard` | Counts, percentages, attention list, upcoming milestones, departments, four-week trend |
| `GET` | `/institutes/:id/departments` | Authorized departments with RAG counts |
| `GET` | `/institutes/:id/projects` | Institute-wide project list (same filters as below) |
| `GET` | `/departments/:id` | Department dashboard, project list and filter options |
| `GET` | `/departments/:id/projects` | Project list only |
| `POST` | `/departments` | Requires `department:manage` |
| `PATCH` | `/departments/:id` | Requires `department:manage` |

Project list query parameters: `status`, `mentorUserId`, `semester`, `academicYear`, `search`,
`overdueActions=true`, `stale=true`, `awaitingReview=true`, and
`sort=severity|oldest_update|next_milestone|mentor|name|completion`.

## Projects

| Method | Path | Requires |
|---|---|---|
| `GET` | `/projects/:id` | `project:view` — returns detail, your permissions on it, and current blockers |
| `GET` | `/projects/:id/history` | `project:view` |
| `GET` | `/projects/:id/recommendation` | `project:view` — advisory RAG with reasons |
| `POST` | `/projects` | `project:create` in the target department's institute |
| `PATCH` | `/projects/:id` | `project:update` |
| `POST` | `/projects/:id/status` | `status:propose` or `status:approve` — see below |
| `POST` | `/projects/:id/issues` | `issue:create` (includes students) |
| `PATCH` | `/projects/:id/issues/:issueId` | `issue:update`; evidence required to resolve/verify/close |
| `POST` | `/projects/:id/actions` | `action:create`; owner and due date required |
| `PATCH` | `/projects/:id/actions/:actionId` | `action:update`; `VERIFIED` additionally requires `action:verify` |
| `POST` | `/projects/:id/reviews` | `review:create` |
| `POST` | `/projects/:id/milestones` · `PATCH .../:milestoneId` | `project:update` |
| `POST` | `/projects/:id/kpis` · `POST .../kpis/:kpiId/measurements` | `project:update` |
| `POST` | `/projects/:id/members` | `project:update` |
| `POST` | `/projects/:id/repositories` · `/attachments` | `artefact:manage` |

### `POST /projects/:id/status`

```json
{ "newStatus": "GREEN", "rationale": "…", "evidence": "…", "nextReviewDate": "2026-09-01" }
```

`rationale` is always required (minimum 10 characters). Moving **RED → GREEN** additionally requires
`status:approve`, at least 20 characters of `evidence`, no open HIGH/CRITICAL challenge, and no
overdue corrective action. Refusals return a specific message and are audited as
`STATUS_CHANGE_REFUSED`.

## Reports

| Method | Path | Requires |
|---|---|---|
| `GET` | `/reports/weekly` | `report:view` — JSON, built from your scope |
| `GET` | `/reports/weekly.csv` | `report:view` — Excel-compatible, UTF-8 BOM, audited |
| `GET` | `/reports/weekly.html` | `report:view` — print-ready page for PDF, audited |
| `POST` | `/reports/weekly/send` | Platform administrator — mails each recipient their own scoped report |

## Administration

| Method | Path | Requires |
|---|---|---|
| `GET` | `/admin/meta` | `user:manage` — grantable roles and the institutes/departments/projects you may target |
| `GET` | `/admin/users` | `user:manage` — accounts in your institutes, showing only in-scope grants |
| `POST` | `/admin/users` | `user:manage` — creates the account with an initial grant and forces a password change |
| `PATCH` | `/admin/users/:id` | `user:manage` — activate/deactivate, rename, reset password |
| `POST` | `/admin/users/:id/grants` | `user:manage` — institute administrators cannot grant platform scope or cross-institute access |
| `DELETE` | `/admin/grants/:id` | `user:manage` — revokes (soft-deletes) a grant |
| `GET` | `/admin/audit?outcome=&action=&limit=` | `audit:view` — scoped to your institutes |
| `POST` | `/admin/institutes` | Platform administrator |
| `POST` | `/admin/sweep` | Platform administrator — runs the time-based notification sweep now |

## Health

`GET /api/health` — unauthenticated liveness check.
