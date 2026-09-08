# ApniLeap Mini Project v3 — UI-only build

A static, dependency-free UI prototype of the Mini-Project Portfolio
Monitoring Portal. There is no backend or real database wired up yet —
every page reads from the hardcoded dataset in [`web/data.js`](web/data.js).

## Run it locally

```bash
npx serve web -l 5500
```

Then open http://localhost:5500 and sign in with:

- **Email:** balaji@apnileap.example
- **Password:** Balaji@2026!

(This is a single hardcoded credential check done in the browser — a UI
placeholder, not real authentication.)

## Pages

- `index.html` — sign-in
- `portfolio.html` — the 6-college portfolio dashboard with a consolidated
  RAG status
- `school.html` → `dept.html` → `faculty.html` → `theme.html` →
  `artifact.html` → `student.html` — a drill-down chain from college down
  to the individual student, with breadcrumbs at every level

## Schema

`server/db/schema.sql` and `server/db/seed.sql` hold the PostgreSQL DDL
and sample data this UI is modeled on:
College → School → Dept → Faculty → Theme → Artifact → Student.
