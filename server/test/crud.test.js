import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('crud');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

const institute = (code) => db.prepare('SELECT * FROM institutes WHERE code = ?').get(code);
const department = (code, instituteCode) =>
  db.prepare('SELECT d.* FROM departments d JOIN institutes i ON i.id = d.institute_id WHERE d.code = ? AND i.code = ?')
    .get(code, instituteCode);
const project = (code) => db.prepare('SELECT * FROM projects WHERE code = ?').get(code);

// ---------------------------------------------------------------------------
// Project: create, edit, delete
// ---------------------------------------------------------------------------

test('an institute administrator can create, edit and delete a project', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example');

  const dep = department('CSE', 'KLE');
  const created = await admin.post('/api/projects', {
    departmentId: dep.id,
    code: 'KLE-CSE-2026-CRUD',
    title: 'CRUD test project',
    academicYear: '2025-26',
    semester: 'Semester 6',
    needStatement: 'Verify create works end to end.',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.project.id;
  assert.equal(created.body.project.rag_status, 'GREEN');

  const detail = await admin.get(`/api/projects/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.project.need_statement, 'Verify create works end to end.');
  assert.ok(detail.body.permissions.includes('project:create'));

  const edited = await admin.patch(`/api/projects/${id}`, {
    title: 'CRUD test project (edited)',
    objective: 'Confirm edits persist.',
    completionPercentage: 40,
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.project.title, 'CRUD test project (edited)');
  assert.equal(edited.body.project.completion_percentage, 40);

  const deleted = await admin.del(`/api/projects/${id}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  const gone = await admin.get(`/api/projects/${id}`);
  assert.equal(gone.status, 404);
});

test('a project with review history cannot be hard-deleted, only archived', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example');
  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');

  const target = project('KLE-CSE-2026-01');

  const blocked = await admin.del(`/api/projects/${target.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /Archive it instead/i);

  // Still fully present.
  const still = await admin.get(`/api/projects/${target.id}`);
  assert.equal(still.status, 200);

  // Archiving remains available and is not blocked by the same rule.
  const archived = await admin.patch(`/api/projects/${target.id}`, { isArchived: true });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.project.is_archived, 1);
  await admin.patch(`/api/projects/${target.id}`, { isArchived: false });
});

test('a faculty mentor cannot delete a project (requires project:create)', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const attempt = await mentor.del(`/api/projects/${target.id}`);
  assert.equal(attempt.status, 403);
});

// ---------------------------------------------------------------------------
// Milestones, KPIs, measurements
// ---------------------------------------------------------------------------

test('a mentor can add, view and delete a milestone', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const added = await mentor.post(`/api/projects/${target.id}/milestones`, {
    title: 'CRUD milestone', plannedDate: '2026-10-01', isCritical: false,
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const milestoneId = added.body.milestone.id;

  const detail = await mentor.get(`/api/projects/${target.id}`);
  assert.ok(detail.body.milestones.some((m) => m.id === milestoneId));

  const deleted = await mentor.del(`/api/projects/${target.id}/milestones/${milestoneId}`);
  assert.equal(deleted.status, 200);

  const after = await mentor.get(`/api/projects/${target.id}`);
  assert.ok(!after.body.milestones.some((m) => m.id === milestoneId));
});

test('deleting a KPI also removes its measurements, and a single measurement can be deleted alone', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const kpi = await mentor.post(`/api/projects/${target.id}/kpis`, {
    name: 'CRUD KPI', targetValue: '10', unit: 'units',
  });
  assert.equal(kpi.status, 201);
  const kpiId = kpi.body.kpi.id;

  const m1 = await mentor.post(`/api/projects/${target.id}/kpis/${kpiId}/measurements`, {
    measuredValue: '3', measurementDate: '2026-08-01', evidence: 'First reading.', meetsTarget: false,
  });
  assert.equal(m1.status, 201);
  const m2 = await mentor.post(`/api/projects/${target.id}/kpis/${kpiId}/measurements`, {
    measuredValue: '6', measurementDate: '2026-08-15', evidence: 'Second reading.', meetsTarget: false,
  });
  assert.equal(m2.status, 201);

  // Delete just the first measurement.
  const delOne = await mentor.del(`/api/projects/${target.id}/kpis/${kpiId}/measurements/${m1.body.measurement.id}`);
  assert.equal(delOne.status, 200);
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM kpi_measurements WHERE kpi_id = ?').get(kpiId).n;
  assert.equal(remaining, 1);

  // Deleting the KPI cascades to the remaining measurement.
  const delKpi = await mentor.del(`/api/projects/${target.id}/kpis/${kpiId}`);
  assert.equal(delKpi.status, 200);
  const afterKpi = db.prepare('SELECT COUNT(*) AS n FROM kpi_measurements WHERE kpi_id = ?').get(kpiId).n;
  assert.equal(afterKpi, 0);
});

// ---------------------------------------------------------------------------
// Team members, repositories, attachments
// ---------------------------------------------------------------------------

test('a mentor can add and remove a team member, repository link and attachment', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const member = await mentor.post(`/api/projects/${target.id}/members`, {
    memberRole: 'STUDENT', teamIdentifier: 'CRUD-TEAM-1',
  });
  assert.equal(member.status, 201);
  const removedMember = await mentor.del(`/api/projects/${target.id}/members/${member.body.member.id}`);
  assert.equal(removedMember.status, 200);

  const repo = await mentor.post(`/api/projects/${target.id}/repositories`, {
    label: 'CRUD repo', repoUrl: 'https://github.com/apnileap-private/crud-test',
  });
  assert.equal(repo.status, 201);
  const removedRepo = await mentor.del(`/api/projects/${target.id}/repositories/${repo.body.repository.id}`);
  assert.equal(removedRepo.status, 200);

  const attachment = await mentor.post(`/api/projects/${target.id}/attachments`, {
    kind: 'REPORT', label: 'CRUD report', externalUrl: 'https://files.example/report.pdf',
  });
  assert.equal(attachment.status, 201);
  const removedAttachment = await mentor.del(`/api/projects/${target.id}/attachments/${attachment.body.attachment.id}`);
  assert.equal(removedAttachment.status, 200);
});

// ---------------------------------------------------------------------------
// Issues and corrective actions: deletable only before they matter
// ---------------------------------------------------------------------------

test('an open challenge can be deleted, but a closed one cannot', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const raised = await mentor.post(`/api/projects/${target.id}/issues`, {
    title: 'CRUD challenge', description: 'Raised only to exercise the delete endpoint.',
  });
  assert.equal(raised.status, 201);
  const issueId = raised.body.issue.id;

  const deletedOpen = await mentor.del(`/api/projects/${target.id}/issues/${issueId}`);
  assert.equal(deletedOpen.status, 200);

  const raised2 = await mentor.post(`/api/projects/${target.id}/issues`, {
    title: 'CRUD challenge 2', description: 'Raised to be closed then protected from deletion.',
  });
  const issueId2 = raised2.body.issue.id;
  const closed = await mentor.patch(`/api/projects/${target.id}/issues/${issueId2}`, {
    status: 'CLOSED', evidence: 'Resolved for the purpose of this test.',
  });
  assert.equal(closed.status, 200);

  const deletedClosed = await mentor.del(`/api/projects/${target.id}/issues/${issueId2}`);
  assert.equal(deletedClosed.status, 409);
  assert.match(deletedClosed.body.error.message, /can no longer be deleted/i);

  // Still there, untouched.
  const detail = await mentor.get(`/api/projects/${target.id}`);
  assert.ok(detail.body.issues.some((i) => i.id === issueId2 && i.status === 'CLOSED'));
});

test('an open corrective action can be deleted, but a verified one cannot', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const head = createClient(baseUrl);
  await head.login('head.cse@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const action = await mentor.post(`/api/projects/${target.id}/actions`, {
    description: 'CRUD action to be deleted while open.', ownerName: 'Someone', dueDate: '2026-12-01',
  });
  assert.equal(action.status, 201);
  const deletedOpen = await mentor.del(`/api/projects/${target.id}/actions/${action.body.action.id}`);
  assert.equal(deletedOpen.status, 200);

  const action2 = await mentor.post(`/api/projects/${target.id}/actions`, {
    description: 'CRUD action to be verified then protected.', ownerName: 'Someone', dueDate: '2026-12-01',
  });
  const actionId2 = action2.body.action.id;
  await mentor.patch(`/api/projects/${target.id}/actions/${actionId2}`, {
    status: 'COMPLETED', evidence: 'Completed for the purpose of this test.',
  });
  const verified = await head.patch(`/api/projects/${target.id}/actions/${actionId2}`, { status: 'VERIFIED' });
  assert.equal(verified.status, 200);

  const deletedVerified = await mentor.del(`/api/projects/${target.id}/actions/${actionId2}`);
  assert.equal(deletedVerified.status, 409);
});

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

test('an empty department is hard-deleted; one with projects is deactivated instead', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example');
  const kle = institute('KLE');

  const created = await admin.post('/api/departments', {
    instituteId: kle.id, code: 'CRUDX', name: 'CRUD Test Department',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const emptyDeptId = created.body.department.id;

  const deletedEmpty = await admin.del(`/api/departments/${emptyDeptId}`);
  assert.equal(deletedEmpty.status, 200);
  assert.equal(deletedEmpty.body.deleted, true);
  assert.equal(db.prepare('SELECT id FROM departments WHERE id = ?').get(emptyDeptId), undefined);

  const cse = department('CSE', 'KLE');
  const deletedWithProjects = await admin.del(`/api/departments/${cse.id}`);
  assert.equal(deletedWithProjects.status, 200);
  assert.equal(deletedWithProjects.body.deleted, false);
  assert.match(deletedWithProjects.body.message, /deactivated/i);

  const row = db.prepare('SELECT is_active FROM departments WHERE id = ?').get(cse.id);
  assert.equal(row.is_active, 0);
  // Its projects must still exist, untouched.
  const stillThere = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE department_id = ?').get(cse.id).n;
  assert.ok(stillThere > 0);

  // Restore for any later run against the same file.
  db.prepare('UPDATE departments SET is_active = 1 WHERE id = ?').run(cse.id);
});

test('a reviewer without department:manage cannot delete a department', async () => {
  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');
  const cse = department('CSE', 'KLE');

  const attempt = await reviewer.del(`/api/departments/${cse.id}`);
  assert.equal(attempt.status, 403);
});

// ---------------------------------------------------------------------------
// Institutes
// ---------------------------------------------------------------------------

test('platform administrator can edit an institute, then delete an empty one', async () => {
  const admin = createClient(baseUrl);
  await admin.login('platform.admin@apnileap.example');

  const created = await admin.post('/api/admin/institutes', {
    code: 'CRUDI', name: 'CRUD Institute', shortName: 'CRUD Inst',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.institute.id;

  const edited = await admin.patch(`/api/admin/institutes/${id}`, { city: 'Testville' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.institute.city, 'Testville');

  const deleted = await admin.del(`/api/admin/institutes/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
});

test('an institute with departments is deactivated rather than deleted', async () => {
  const admin = createClient(baseUrl);
  await admin.login('platform.admin@apnileap.example');
  const kle = institute('KLE');

  const deleted = await admin.del(`/api/admin/institutes/${kle.id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, false);

  const row = db.prepare('SELECT is_active FROM institutes WHERE id = ?').get(kle.id);
  assert.equal(row.is_active, 0);

  // Restore immediately: later tests in this run, and any manual reseed, depend on KLE being active.
  await admin.patch(`/api/admin/institutes/${kle.id}`, { isActive: true });
  const restored = db.prepare('SELECT is_active FROM institutes WHERE id = ?').get(kle.id);
  assert.equal(restored.is_active, 1);
});

test('an institute administrator cannot edit or delete an institute', async () => {
  const kleAdmin = createClient(baseUrl);
  await kleAdmin.login('admin.kle@kletech.example');
  const kle = institute('KLE');

  assert.equal((await kleAdmin.patch(`/api/admin/institutes/${kle.id}`, { city: 'Nope' })).status, 403);
  assert.equal((await kleAdmin.del(`/api/admin/institutes/${kle.id}`)).status, 403);
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

test('a platform administrator can delete a user account outright', async () => {
  const admin = createClient(baseUrl);
  await admin.login('platform.admin@apnileap.example');

  const create = await admin.post('/api/admin/users', {
    email: 'crud.delete.me@kletech.example',
    fullName: 'Temporary CRUD User',
    temporaryPassword: 'TempPass1234',
    grant: { role: 'READ_ONLY', scopeType: 'INSTITUTE', instituteId: institute('KLE').id },
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const userId = create.body.user.id;

  // The audit log already has entries for this actor (the creation itself);
  // deletion must still succeed and leave those entries readable.
  const deleted = await admin.del(`/api/admin/users/${userId}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  assert.equal(db.prepare('SELECT id FROM users WHERE id = ?').get(userId), undefined);
  const auditRow = db.prepare("SELECT * FROM audit_log WHERE detail LIKE '%crud.delete.me%'").get();
  assert.ok(auditRow, 'the USER_CREATED audit entry should still exist');
});

test('a user cannot delete their own account', async () => {
  const admin = createClient(baseUrl);
  const me = await admin.login('platform.admin@apnileap.example');
  const attempt = await admin.del(`/api/admin/users/${me.user.id}`);
  assert.equal(attempt.status, 400);
});

/**
 * There is no route by which a live actor can delete the sole remaining
 * platform administrator: deleting yourself is refused outright (tested
 * above), and an institute administrator is refused before that check ever
 * runs, because any account holding a platform-scoped grant is outside what
 * an institute administrator may touch (also tested above). Those two rules
 * compose to make a zero-admin state unreachable. What *is* reachable, and
 * worth proving, is that a platform admin can freely delete a fellow platform
 * admin as long as at least one other remains to take over administration -
 * the isLastPlatformAdmin guard exists to stop that specific case from ever
 * going to zero, and this is the scenario it must still allow.
 */
test('a platform administrator can delete another one, as long as one remains', async () => {
  const original = createClient(baseUrl);
  await original.login('platform.admin@apnileap.example');

  const secondAdmin = await original.post('/api/admin/users', {
    email: 'second.platform.admin@apnileap.example',
    fullName: 'Second Platform Admin',
    temporaryPassword: 'TempPass1234',
    grant: { role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' },
  });
  assert.equal(secondAdmin.status, 201, JSON.stringify(secondAdmin.body));
  const secondId = secondAdmin.body.user.id;

  const before = db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE role = 'PLATFORM_ADMIN' AND is_active = 1").get().n;
  assert.equal(before, 2);

  const deleted = await original.del(`/api/admin/users/${secondId}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  const after = db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE role = 'PLATFORM_ADMIN' AND is_active = 1").get().n;
  assert.equal(after, 1, 'the original platform administrator must still be standing');
});

test('an institute administrator cannot delete a user who holds access outside their institute', async () => {
  const kleAdmin = createClient(baseUrl);
  await kleAdmin.login('admin.kle@kletech.example');
  const balaji = db.prepare("SELECT id FROM users WHERE email = 'balaji@apnileap.example'").get();

  const attempt = await kleAdmin.del(`/api/admin/users/${balaji.id}`);
  assert.equal(attempt.status, 403);
  assert.ok(db.prepare('SELECT id FROM users WHERE id = ?').get(balaji.id), 'balaji must be untouched');
});
