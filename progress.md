# Progress — Foundation Integration Extension v2 (Handbook v4 correction)

**Status: COMPLETE.** All code, tests, docs and the live database are corrected, verified, and
ready to commit/push. See "Remaining" at the bottom for the one open item (git push permission).

## Context
User attached two new authoritative source documents (2026-09-06):
- `Generic Mini Project Framework V1 Sept 5th 2026.pptx`
- `Mini_Project_Handbook_CS_v4.docx`

These correct/refine the earlier (v1) Foundation Integration extension, which was built from a
less precise slide deck and got several things wrong: gate mark weights (had 100 total, should
be 50 = 5+10+10+15+10), stage names/order, no engine template, no sprints concept, no COE
calendar, no per-student gate marking, wrong decision enum (had PASS/CONDITIONAL_PASS/FAIL/
RESUBMIT_REQUIRED; handbook only uses PASS/RESUBMIT).

User feedback: "you are making a lot of mistakes... build it correctly." Response: a full,
careful rebuild against the handbook text (not guessing), with source citations in code comments
and in `docs/DATABASE-DESIGN.txt` for every non-obvious design decision — most notably the Gate
3/4 rubric-criteria reconstruction (`server/src/db/seedFoundation.js`, comment above
`RUBRIC_CRITERIA_BY_GATE`), which is derived and verified against the handbook's own numbers
rather than invented, with the reconstruction logic spelled out inline.

## What changed (backend)
- **`server/src/db/schema.sql`** — Foundation Integration section (starting at "SECTION 9" style
  comment) fully corrected:
  - `project_themes` — unchanged (both source documents list identical 10 themes).
  - `project_engines` — full 13-field Engine Definition & Readiness Template (primary_course,
    inputs, outputs, internal_state, algorithm_mechanism, interface_spec, dependencies_note,
    kpi_target, failure_case, validation_method). Old `category`/`inputs_outputs` columns from v1
    left in place, unused (SQLite can't cheaply drop a column).
  - `gates` — corrected marks_weight (5/10/10/15/10, sums to 50 not 100), added stage_range,
    primary_review_focus, course_outcomes, default_week_number.
  - `stage_definitions` — corrected to the handbook's 8 stage names/order, added
    primary_question/expected_outcome/is_sequential_foundation.
  - `stage_gate_map` (NEW) — many-to-many stage↔gate, since Gate 3 and Gate 4 both review S6/S7.
  - `sprints` (NEW) — 3 sprints, read-only reference catalog.
  - `calendar_weeks` (NEW) — 17-week COE-aligned calendar (academic_year-scoped).
  - `gate_rubric_criteria` (NEW) — per-gate weighted criteria; Gate 0 has full verbatim 0-5
    descriptors; Gates 1-4 reconstructed from Table 1.3.1 and verified to sum correctly.
  - `project_gate_reviews` — decision enum narrowed to PASS/RESUBMIT (the handbook's actual
    terms); marks_awarded/bloom_answers removed (team-level record only now).
  - `project_gate_review_scores` (NEW) — per-student marks ("5 MARKS PER STUDENT").
  - `project_gate_evidence`, `project_weekly_checkins` — unchanged.
- **`server/src/db/seedFoundation.js`** — completely rewritten with corrected data; switched
  reference-catalog seeding from insert-if-missing to UPSERT (pedagogy corrections must reach an
  already-running deployment); `project_themes` stays insert-if-missing (preserves live faculty
  ownership data).
- **`server/src/db/connection.js`** — migration logic hardened through real bugs found by testing
  against copies of the actual live database (see "Bugs found and fixed" below).
- **`server/src/routes/projects.routes.js`** — engine schema/routes rewritten for the 13-field
  template with a real `engineMeetsApprovalBar()` gate on APPROVED status; gate-review conduct
  endpoint rewritten for PASS/RESUBMIT + per-student `studentScores` scored against
  `gate_rubric_criteria`, marks computed server-side.
- **`server/src/routes/gates.routes.js`** — `GET /api/gates` returns gates+criteria+stages+
  sprints; new `GET /api/gates/calendar` returns the 17-week calendar with `is_current_week`.
- **`server/test/foundation.test.js`** — fully rewritten for the corrected model.

## What changed (frontend)
- **`web/src/pages/ProjectPage.tsx`** — passes `studentMembers` down to `FoundationPanel` for the
  per-student gate-marking form.
- **`web/src/components/FoundationPanel.tsx`** — fully rewritten: full engine template
  display/edit, new "Sprints & COE calendar" card, gate review form with per-student rubric
  marking (checkbox per student, 0-5 rating per criterion, live marks preview, viva notes),
  decision limited to Pass/Resubmit.

## What changed (docs)
- **`docs/DATABASE-DESIGN.txt`** Section 9 fully rewritten: corrected header note (implemented,
  not proposed), updated entity-group list and hierarchy diagram, and a full 9.0-9.12 rewrite with
  handbook citations throughout, the Gate 3/4 reconstruction logic spelled out, a 9.10 explaining
  the v1→v2 migration mechanics, and a 9.12 that explicitly lists documented gaps (S1-S7 evidence
  checklists, Gates 1-4 rubric descriptors, 8/10 themes' minimum_evidence) instead of inventing
  content the source material doesn't actually provide.

## Bugs found and fixed (all via testing against real/copied data, not just reading code)
1. **DROP TABLE cascade into an append-only trigger.** An early attempt to force-rebuild `gates`
   by dropping and recreating it cascaded (via `project_gate_reviews.gate_id ON DELETE CASCADE`)
   into that table's append-only guard trigger and aborted the whole migration. Fixed: `gates`/
   `stage_definitions` use additive `addColumnIfMissing` only, never dropped.
2. **NOT NULL failure on a vestigial column.** `stage_definitions.gate_id` (NOT NULL in v1,
   removed from the v2 schema) still exists on an already-migrated table; the new upsert doesn't
   supply it. Fixed with a runtime column-existence check that supplies a legacy value only when
   the column is actually present.
3. **Dangling foreign key from a table rename (the big one).** Renaming `project_gate_reviews`
   aside (to rebuild its CHECK constraint) silently rewrote `project_gate_evidence`'s FOREIGN KEY
   clause to point at the temporary name too — SQLite's "table rename updates references in other
   schema objects" behaviour turns out to include other tables' REFERENCES clauses, not just
   trigger bodies. Once the temp table was dropped, every INSERT into `project_gate_evidence`
   failed with `no such table: main.project_gate_reviews_v1`. Found via the live server's actual
   stack trace during curl-based verification — not something `node --test` could ever catch,
   since the automated suite always seeds a brand-new database and never exercises the rename
   path. Fixed generically (`repairDanglingForeignKeysIfNeeded`/`finishForeignKeyRepair` in
   `connection.js`): detects any table with a foreign key pointing at a currently-nonexistent
   table and rebuilds it the same rename/recreate/copy-back way. A second-order timing bug in the
   first attempt at this fix (checking too early, before the dangling state actually existed)
   required restructuring to re-run `db.exec(schema)` a second time (harmless, all `IF NOT
   EXISTS`) so the whole self-heal completes within a single `migrate()` call rather than needing
   a second server restart.

## Verification performed
- `node --test` in `server/`: **70/70 passing**, no regressions.
- `tsc --noEmit` and `npm run build` in `web/`: clean.
- Migration tested against: a fresh database, a copy of the live database mid-way through this
  work, and a copy of the *original* pre-v2 backup (`server/data/portal.db.bak-20260907075249`) —
  including proving the repaired foreign key actually accepts an INSERT, and confirming
  idempotency (two `migrate()` calls back-to-back, no errors/duplication).
- **Live end-to-end verification** against the actual running dev server and real database
  (project `KLE-CSE-2026-06`, both via curl and in the real browser UI, logged in as
  `mentor.hegde@kletech.example`): theme assignment; a fully-specified engine auto-approved with
  every new template field persisted; a Gate 0 review with real per-student rubric scoring
  (verified exact arithmetic: 4 criteria × 4/5 × 1.25 = 4.0 marks); the gate ladder correctly
  unlocking Gate 1 and keeping Gate 2+ locked; a Gate 1 Resubmit correctly leaving Gate 2 locked;
  the UI rendering the corrected 50-mark total, stage/gate names, CO codes, the Sprints & COE
  calendar card, and the full engine template detail view.
- Live database backed up before migrating: `server/data/portal.db.bak-20260907075249`.

## Remaining
- [ ] **Commit and push.** Everything above is done and verified — nothing left to build. `git
      push` was blocked by this session's auto-mode permission classifier in the prior session;
      the user had to loosen the permission on their end before a retry of the exact same command
      succeeded (mechanism unclear from this side — not the interactive `/permissions` command,
      which needs a terminal this session doesn't have). Try the push; if blocked, say so plainly
      and let the user either run it themselves or loosen the permission again, exactly as before.
