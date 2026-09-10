import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('isolation');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

function institute(code) {
  return db.prepare('SELECT * FROM institutes WHERE code = ?').get(code);
}
function project(code) {
  return db.prepare('SELECT * FROM projects WHERE code = ?').get(code);
}
function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

/**
 * Requirement 7, mandatory test: "If a KLE user changes a URL, request parameter
 * or project ID to one belonging to another institute, the backend must reject
 * the request and create an audit event."
 */
test('a KLE user cannot reach another institute\'s records by changing identifiers', async () => {
  const kleUser = createClient(baseUrl);
  await kleUser.login('narayan@kletech.example'); // Dean, KLE only

  const mmcoe = institute('MMCOE');
  const rit = institute('RIT');
  const mmcoeProject = project('MMCOE-ENTC-2026-02');
  const mmcoeDepartment = db
    .prepare('SELECT * FROM departments WHERE institute_id = ? LIMIT 1')
    .get(mmcoe.id);

  const before = auditCount('CROSS_TENANT_ACCESS_DENIED');

  const attempts = [
    await kleUser.get(`/api/institutes/${mmcoe.id}/dashboard`),
    await kleUser.get(`/api/institutes/${rit.id}/departments`),
    await kleUser.get(`/api/departments/${mmcoeDepartment.id}`),
    await kleUser.get(`/api/projects/${mmcoeProject.id}`),
    await kleUser.get(`/api/projects/${mmcoeProject.id}/history`),
  ];

  for (const attempt of attempts) {
    assert.equal(attempt.status, 404, 'cross-tenant access must be refused');
    // The response must not confirm that the record exists.
    assert.equal(attempt.body.error.code, 'NOT_FOUND');
    assert.ok(!JSON.stringify(attempt.body).includes('MMCOE'));
  }

  const after = auditCount('CROSS_TENANT_ACCESS_DENIED');
  assert.equal(after - before, attempts.length, 'every refusal must create an audit event');
});

test('a KLE user cannot write to another institute\'s project', async () => {
  const kleUser = createClient(baseUrl);
  await kleUser.login('admin.kle@kletech.example'); // Institute Administrator, KLE

  const mmcoeProject = project('MMCOE-ENTC-2026-02');

  const write = await kleUser.post(`/api/projects/${mmcoeProject.id}/issues`, {
    title: 'Injected challenge from another institute',
    description: 'This request must never be accepted by the backend.',
  });
  assert.equal(write.status, 404);

  const status = await kleUser.post(`/api/projects/${mmcoeProject.id}/status`, {
    newStatus: 'GREEN',
    rationale: 'Attempting to alter a project belonging to another institute.',
  });
  assert.equal(status.status, 404);

  const stored = db.prepare('SELECT rag_status FROM projects WHERE id = ?').get(mmcoeProject.id);
  assert.equal(stored.rag_status, 'RED', 'the target project must be untouched');
});

test('institute listing shows only authorized institutes', async () => {
  const kleUser = createClient(baseUrl);
  await kleUser.login('narayan@kletech.example');
  const kleView = await kleUser.get('/api/institutes');
  assert.equal(kleView.status, 200);
  assert.equal(kleView.body.institutes.length, 1);
  assert.equal(kleView.body.institutes[0].code, 'KLE');
  assert.equal(kleView.body.autoSelectInstituteId, kleView.body.institutes[0].id);

  const global = createClient(baseUrl);
  await global.login('balaji@apnileap.example');
  const globalView = await global.get('/api/institutes');
  assert.equal(globalView.body.institutes.length, 5);
  assert.equal(globalView.body.canViewProgrammeRollup, true);
});

test('a department-scoped user sees only their own department and its projects', async () => {
  const head = createClient(baseUrl);
  await head.login('head.cse@kletech.example'); // Department Head, KLE CSE

  const kle = institute('KLE');
  const departments = await head.get(`/api/institutes/${kle.id}/departments`);
  assert.equal(departments.status, 200);
  assert.equal(departments.body.departments.length, 1);
  assert.equal(departments.body.departments[0].code, 'CSE');

  const eceProject = project('KLE-ECE-2026-02');
  const blocked = await head.get(`/api/projects/${eceProject.id}`);
  assert.equal(blocked.status, 404, 'another department in the same institute is still out of scope');

  const ownProject = project('KLE-CSE-2026-04');
  const allowed = await head.get(`/api/projects/${ownProject.id}`);
  assert.equal(allowed.status, 200);
});

test('a project-scoped student sees only the assigned project', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');

  const own = await student.get(`/api/projects/${project('KLE-CSE-2026-04').id}`);
  assert.equal(own.status, 200);

  const other = await student.get(`/api/projects/${project('KLE-CSE-2026-01').id}`);
  assert.equal(other.status, 404);

  // The student's institute list still resolves, but only to the owning institute.
  const institutes = await student.get('/api/institutes');
  assert.equal(institutes.body.institutes.length, 1);
  assert.equal(institutes.body.institutes[0].project_count, 1);
});

test('unauthenticated requests are refused', async () => {
  const anonymous = createClient(baseUrl);
  const result = await anonymous.get('/api/institutes');
  assert.equal(result.status, 401);
});

test('a deactivated account loses access immediately', async () => {
  const user = createClient(baseUrl);
  await user.login('trustee@apnileap.example');
  assert.equal((await user.get('/api/me')).status, 200);

  const admin = createClient(baseUrl);
  await admin.login('platform.admin@apnileap.example');
  const trustee = db.prepare("SELECT id FROM users WHERE email = 'trustee@apnileap.example'").get();
  const deactivate = await admin.patch(`/api/admin/users/${trustee.id}`, { isActive: false });
  assert.equal(deactivate.status, 200);

  const afterRevocation = await user.get('/api/me');
  assert.equal(afterRevocation.status, 401, 'the existing session must stop working at once');

  // Restore for any later runs against the same file.
  await admin.patch(`/api/admin/users/${trustee.id}`, { isActive: true });
});
