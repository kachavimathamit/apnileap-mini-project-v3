import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('reporting');

const { baseUrl, close } = await startServer();

test.after(() => close());

/** Acceptance criterion: weekly reports include only the recipient's authorized scope. */
test('the weekly report is scoped to each recipient', async () => {
  const global = createClient(baseUrl);
  await global.login('balaji@apnileap.example');
  const globalReport = await global.get('/api/reports/weekly');
  assert.equal(globalReport.status, 200);
  assert.equal(globalReport.body.instituteSummary.length, 5);

  const kleOnly = createClient(baseUrl);
  await kleOnly.login('narayan@kletech.example');
  const kleReport = await kleOnly.get('/api/reports/weekly');
  assert.equal(kleReport.status, 200);
  assert.equal(kleReport.body.instituteSummary.length, 1);
  assert.equal(kleReport.body.instituteSummary[0].short_name, 'KLE Tech');

  // No other institute may appear anywhere in the payload.
  const serialised = JSON.stringify(kleReport.body);
  for (const name of ['MMCOE', 'RIT', 'COEP', 'Sangli']) {
    assert.ok(!serialised.includes(name), `${name} must not appear in a KLE-only report`);
  }

  assert.ok(kleReport.body.totals.total < globalReport.body.totals.total);
});

test('the CSV export is scoped and audited', async () => {
  const kleOnly = createClient(baseUrl);
  await kleOnly.login('narayan@kletech.example');

  const csv = await kleOnly.get('/api/reports/weekly.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes('KLE Tech'));
  assert.ok(!csv.body.includes('MMCOE'));

  const { db } = await import('../src/db/connection.js');
  const exports = db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'WEEKLY_REPORT_EXPORTED'")
    .get().n;
  assert.ok(exports >= 1, 'exports must be recorded in the audit log');
});

test('a student has no access to management reporting', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  assert.equal((await student.get('/api/reports/weekly')).status, 403);
});

test('an institute administrator sees an audit trail limited to their institute', async () => {
  const kleAdmin = createClient(baseUrl);
  await kleAdmin.login('admin.kle@kletech.example');

  const audit = await kleAdmin.get('/api/admin/audit');
  assert.equal(audit.status, 200);

  const { db } = await import('../src/db/connection.js');
  const mmcoe = db.prepare("SELECT id FROM institutes WHERE code = 'MMCOE'").get();
  const leaked = audit.body.entries.filter((entry) => entry.institute_id === mmcoe.id);
  assert.equal(leaked.length, 0);
});

test('an institute administrator cannot grant platform-wide access', async () => {
  const kleAdmin = createClient(baseUrl);
  await kleAdmin.login('admin.kle@kletech.example');

  const { db } = await import('../src/db/connection.js');
  const mentor = db.prepare("SELECT id FROM users WHERE email = 'mentor.hegde@kletech.example'").get();

  const escalate = await kleAdmin.post(`/api/admin/users/${mentor.id}/grants`, {
    role: 'PLATFORM_ADMIN',
    scopeType: 'PLATFORM',
  });
  assert.equal(escalate.status, 403);

  const mmcoe = db.prepare("SELECT id FROM institutes WHERE code = 'MMCOE'").get();
  const crossTenant = await kleAdmin.post(`/api/admin/users/${mentor.id}/grants`, {
    role: 'FACULTY_MENTOR',
    scopeType: 'INSTITUTE',
    instituteId: mmcoe.id,
  });
  assert.equal(crossTenant.status, 403);
});

test('an institute administrator cannot manage a user from another institute', async () => {
  const kleAdmin = createClient(baseUrl);
  await kleAdmin.login('admin.kle@kletech.example');

  const { db } = await import('../src/db/connection.js');
  const foreign = db.prepare("SELECT id FROM users WHERE email = 'mentor.kale@mmcoe.example'").get();

  const attempt = await kleAdmin.patch(`/api/admin/users/${foreign.id}`, { isActive: false });
  assert.equal(attempt.status, 404);

  const still = db.prepare('SELECT is_active FROM users WHERE id = ?').get(foreign.id);
  assert.equal(still.is_active, 1);
});

test('login failures are audited and do not reveal whether an account exists', async () => {
  const client = createClient(baseUrl);

  const unknown = await client.post('/api/auth/login', {
    email: 'nobody@nowhere.example',
    password: 'whatever-value-here',
  });
  const wrongPassword = await client.post('/api/auth/login', {
    email: 'balaji@apnileap.example',
    password: 'definitely-not-the-password',
  });

  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(unknown.body, wrongPassword.body, 'both failures must look identical');

  const { db } = await import('../src/db/connection.js');
  const failures = db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'LOGIN_FAILED'")
    .get().n;
  assert.ok(failures >= 2);
});

test('the landing payload reports the active role, scope and last refresh', async () => {
  const client = createClient(baseUrl);
  await client.login('narayan@kletech.example');

  const me = await client.get('/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.access.roles, ['DEAN']);
  assert.equal(me.body.access.scopeDescription, 'KLE Tech (full institute)');
  assert.ok(me.body.system.lastDataRefresh);
  assert.ok(me.body.system.ragDefinitions.RED.criteria.length > 0);
});
