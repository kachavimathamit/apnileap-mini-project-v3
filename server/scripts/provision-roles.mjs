/**
 * One-off provisioning script: creates/fixes one account per role in the
 * requested capability table, with fixed passwords (no forced change), and
 * gives the Faculty Mentor real, multiple assigned projects so the rubric
 * review workflow has genuine teams to run across.
 *
 * Not part of the running application - run manually, once, with:
 *   node scripts/provision-roles.mjs
 */
import { db, migrate, newId } from '../src/db/connection.js';
import { hashPassword } from '../src/auth/password.js';

migrate();

const KLE = db.prepare("SELECT id FROM institutes WHERE code = 'KLE'").get().id;
const CSE = db.prepare("SELECT id FROM departments WHERE code = 'CSE' AND institute_id = ?").get(KLE).id;
const ALL_INSTITUTES = db.prepare('SELECT id FROM institutes').all().map((r) => r.id);
const ADMIN = db.prepare("SELECT id FROM users WHERE email = 'platform.admin@apnileap.example'").get();

async function setFixedPassword(email, password) {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return false;
  const hash = await hashPassword(password);
  db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1,
                      failed_login_count = 0, locked_until = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(hash, user.id);
  return true;
}

async function createAccount({ email, fullName, designation, password, role, scopeType, instituteId, departmentId }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    await setFixedPassword(email, password);
    console.log('updated password for existing:', email);
    return existing.id;
  }
  const hash = await hashPassword(password);
  const userId = newId('usr');
  db.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, designation, must_change_password) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(userId, email, hash, fullName, designation ?? null);

  if (scopeType === 'PLATFORM') {
    db.prepare("INSERT INTO access_grants (id, user_id, role, scope_type, granted_by) VALUES (?, ?, ?, 'PLATFORM', ?)")
      .run(newId('grt'), userId, role, ADMIN.id);
  } else if (Array.isArray(instituteId)) {
    for (const inst of instituteId) {
      db.prepare(
        "INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, granted_by) VALUES (?, ?, ?, 'INSTITUTE', ?, ?)",
      ).run(newId('grt'), userId, role, inst, ADMIN.id);
    }
  } else if (scopeType === 'DEPARTMENT') {
    db.prepare(
      "INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, department_id, granted_by) VALUES (?, ?, ?, 'DEPARTMENT', ?, ?, ?)",
    ).run(newId('grt'), userId, role, instituteId, departmentId, ADMIN.id);
  } else {
    db.prepare(
      "INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, granted_by) VALUES (?, ?, ?, 'INSTITUTE', ?, ?)",
    ).run(newId('grt'), userId, role, instituteId, ADMIN.id);
  }
  console.log('created:', email);
  return userId;
}

// 1. Fix passwords on the accounts that already exist (Platform Admin, Dept Head, Faculty Mentor).
await setFixedPassword('platform.admin@apnileap.example', 'Passw0rd!2026');
await setFixedPassword('head.cse@kletech.example', 'DeptHead@2026!');
await setFixedPassword('mentor.hegde@kletech.example', 'Mentor@2026!');

// 2. Create the five missing roles.
await createAccount({
  email: 'programme.leader@apnileap.example', fullName: 'Global Programme Leader',
  designation: 'ApniLeap programme leadership', password: 'Leader@2026!',
  role: 'GLOBAL_PROGRAMME_LEADER', scopeType: 'INSTITUTE', instituteId: ALL_INSTITUTES,
});
await createAccount({
  email: 'institute.admin@kletech.example', fullName: 'Institute Administrator',
  designation: 'KLE Technological University', password: 'InstAdmin@2026!',
  role: 'INSTITUTE_ADMIN', scopeType: 'INSTITUTE', instituteId: KLE,
});
await createAccount({
  email: 'dean@kletech.example', fullName: 'Dean / Principal',
  designation: 'Dean, KLE Technological University', password: 'Dean@2026!',
  role: 'DEAN', scopeType: 'INSTITUTE', instituteId: KLE,
});
await createAccount({
  email: 'reviewer.coach@apnileap.example', fullName: 'Reviewer / Success Coach',
  designation: 'ApniLeap success coaching', password: 'Reviewer@2026!',
  role: 'REVIEWER', scopeType: 'INSTITUTE', instituteId: KLE,
});
await createAccount({
  email: 'stakeholder@apnileap.example', fullName: 'Read-only Stakeholder',
  designation: 'Programme trustee (read-only)', password: 'ReadOnly@2026!',
  role: 'READ_ONLY', scopeType: 'INSTITUTE', instituteId: KLE,
});

// 3. Give the Faculty Mentor real "assigned projects" (plural) so the rubric
//    review feature has genuine teams to work across, not just one.
const mentor = db.prepare("SELECT id, full_name FROM users WHERE email = 'mentor.hegde@kletech.example'").get();

const extraProjects = [
  { code: 'KLE-CSE-2026-05', title: 'Smart irrigation scheduler for the campus garden' },
  { code: 'KLE-CSE-2026-06', title: 'Accessible lecture-capture indexing tool' },
];
for (const p of extraProjects) {
  if (db.prepare('SELECT id FROM projects WHERE code = ?').get(p.code)) continue;
  const projectId = newId('prj');
  db.prepare(
    `INSERT INTO projects (id, code, institute_id, department_id, title, academic_year, semester, created_by)
     VALUES (?, ?, ?, ?, ?, '2025-26', 'Semester 6', ?)`,
  ).run(projectId, p.code, KLE, CSE, p.title, ADMIN.id);
  db.prepare(
    "INSERT INTO status_history (id, project_id, institute_id, previous_status, new_status, changed_by, changed_by_name, rationale) VALUES (?, ?, ?, NULL, 'GREEN', ?, ?, 'Project registered.')",
  ).run(newId('sth'), projectId, KLE, ADMIN.id, 'Platform Administrator');
  db.prepare(
    "INSERT INTO project_members (id, project_id, institute_id, user_id, member_role, status, approved_by, approved_by_name, approved_at) VALUES (?, ?, ?, ?, 'FACULTY_MENTOR', 'APPROVED', ?, ?, datetime('now'))",
  ).run(newId('mem'), projectId, KLE, mentor.id, ADMIN.id, 'Platform Administrator');
  console.log('created project + assigned guide:', p.code);
}

console.log('\nDone.');
