import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('workflow');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

const project = (code) => db.prepare('SELECT * FROM projects WHERE code = ?').get(code);

/**
 * Requirement 5.6 step 6 and the MVP acceptance criteria: a Red project cannot
 * return to Green without evidence of resolution and reviewer approval.
 */
test('a mentor cannot move a Red project back to Green', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');

  const red = project('KLE-CSE-2026-04');
  assert.equal(red.rag_status, 'RED');

  const attempt = await mentor.post(`/api/projects/${red.id}/status`, {
    newStatus: 'GREEN',
    rationale: 'The team says the hardware situation is now resolved.',
    evidence: 'Verbal confirmation from the team during the weekly meeting, actuators expected soon.',
  });

  assert.equal(attempt.status, 403);
  assert.match(attempt.body.error.message, /authorized reviewer/i);
  assert.equal(project('KLE-CSE-2026-04').rag_status, 'RED');

  const refusals = db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'STATUS_CHANGE_REFUSED'")
    .get().n;
  assert.ok(refusals >= 1, 'a refused transition must be audited');
});

test('a reviewer cannot move Red to Green without evidence', async () => {
  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');

  const red = project('KLE-CSE-2026-04');
  const noEvidence = await reviewer.post(`/api/projects/${red.id}/status`, {
    newStatus: 'GREEN',
    rationale: 'Closing this out after the discussion in the review meeting.',
  });

  assert.equal(noEvidence.status, 409);
  assert.match(noEvidence.body.error.message, /evidence/i);
});

test('a reviewer cannot move Red to Green while critical challenges remain open', async () => {
  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');

  const red = project('KLE-CSE-2026-04');
  const blocked = await reviewer.post(`/api/projects/${red.id}/status`, {
    newStatus: 'GREEN',
    rationale: 'Hardware has arrived and the prototype is being assembled.',
    evidence: 'Delivery note dated this week plus photographs of the assembled eight-cell array.',
  });

  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /challenge/i);
});

test('the full Red-to-Green path succeeds once evidence and closure are in place', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');

  const red = project('KLE-CSE-2026-04');
  const detail = await mentor.get(`/api/projects/${red.id}`);
  assert.equal(detail.status, 200);

  // 1. Close every open challenge, each requiring evidence.
  for (const issue of detail.body.issues.filter((i) => !['VERIFIED', 'CLOSED'].includes(i.status))) {
    const closed = await mentor.patch(`/api/projects/${red.id}/issues/${issue.id}`, {
      status: 'CLOSED',
      evidence: 'Actuators received on 12 August; bench test log attached showing all eight cells actuating.',
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  }

  // 2. Complete every outstanding corrective action, also evidence-backed.
  for (const action of detail.body.actions.filter((a) => ['OPEN', 'IN_PROGRESS'].includes(a.status))) {
    const done = await mentor.patch(`/api/projects/${red.id}/actions/${action.id}`, {
      status: 'COMPLETED',
      evidence: 'Customs cleared and hardware delivered; purchase office confirmation attached.',
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
  }

  // 3. Only now can an authorized reviewer restore Green.
  const restored = await reviewer.post(`/api/projects/${red.id}/status`, {
    newStatus: 'GREEN',
    rationale: 'Hardware delivered, prototype assembled and all corrective actions verified.',
    evidence: 'Bench test log, delivery note and updated milestone plan reviewed on screen during the review call.',
  });

  assert.equal(restored.status, 201, JSON.stringify(restored.body));
  assert.equal(project('KLE-CSE-2026-04').rag_status, 'GREEN');

  // 4. The transition is preserved with its approver (requirement 5.7).
  const history = await reviewer.get(`/api/projects/${red.id}/history`);
  const latest = history.body.history[0];
  assert.equal(latest.previous_status, 'RED');
  assert.equal(latest.new_status, 'GREEN');
  assert.equal(latest.approved_by_name, 'Priya Raman');
  assert.ok(latest.evidence.length > 20);
});

test('status history is append-only', () => {
  const row = db.prepare('SELECT id FROM status_history LIMIT 1').get();
  assert.throws(
    () => db.prepare('UPDATE status_history SET rationale = ? WHERE id = ?').run('rewritten', row.id),
    /append-only/,
  );
  assert.throws(
    () => db.prepare('DELETE FROM status_history WHERE id = ?').run(row.id),
    /append-only/,
  );
});

test('the audit log cannot be rewritten', () => {
  const row = db.prepare('SELECT id FROM audit_log LIMIT 1').get();
  assert.throws(() => db.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id), /append-only/);
});

test('a student can raise a challenge but cannot change status', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');

  const raised = await student.post(`/api/projects/${target.id}/issues`, {
    title: 'Bench harness unavailable during lab hours',
    description: 'The shared bench harness is booked for other batches during our scheduled lab slot.',
    impact: 'We can only test for one hour a week, which slows firmware validation.',
    assistanceRequired: 'A dedicated bench slot on Wednesday afternoons.',
    severity: 'MEDIUM',
  });
  assert.equal(raised.status, 201, JSON.stringify(raised.body));

  const refused = await student.post(`/api/projects/${target.id}/status`, {
    newStatus: 'RED',
    rationale: 'We think this project is in serious trouble and should be marked red.',
  });
  assert.equal(refused.status, 403);
});

test('a read-only stakeholder cannot modify anything', async () => {
  const observer = createClient(baseUrl);
  await observer.login('trustee@apnileap.example');
  const target = project('MMCOE-CSE-2026-01');

  assert.equal((await observer.get(`/api/projects/${target.id}`)).status, 200);
  assert.equal(
    (await observer.post(`/api/projects/${target.id}/issues`, {
      title: 'An observer should not be able to write this',
      description: 'This request must be refused by the authorization layer.',
    })).status,
    403,
  );
  assert.equal(
    (await observer.patch(`/api/projects/${target.id}`, { completionPercentage: 100 })).status,
    403,
  );
});

test('a corrective action cannot be verified by someone without the verify capability', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.pawar@rit.example');
  const target = project('RIT-CSE-2026-01');

  const detail = await mentor.get(`/api/projects/${target.id}`);
  const action = detail.body.actions[0];

  const attempt = await mentor.patch(`/api/projects/${target.id}/actions/${action.id}`, {
    status: 'VERIFIED',
    evidence: 'The mentor believes this work is complete and is signing it off personally.',
  });
  assert.equal(attempt.status, 400);
  assert.match(attempt.body.error.message, /reviewer, department head or administrator/i);
});

test('every status change is preserved in history with a rationale', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.nayak@kletech.example');
  const target = project('KLE-ECE-2026-02');

  const before = db
    .prepare('SELECT COUNT(*) AS n FROM status_history WHERE project_id = ?')
    .get(target.id).n;

  const change = await mentor.post(`/api/projects/${target.id}/status`, {
    newStatus: 'RED',
    rationale: 'Calibration has not improved after two attempts and the deployment window is closing.',
  });
  assert.equal(change.status, 201);

  const after = db.prepare('SELECT * FROM status_history WHERE project_id = ? ORDER BY changed_at DESC').all(target.id);
  assert.equal(after.length, before + 1);
  assert.equal(after[0].previous_status, 'YELLOW');
  assert.equal(after[0].new_status, 'RED');
  assert.equal(after[0].changed_by_name, 'Prof. Meera Nayak');
  assert.ok(after[0].rationale.length >= 10);

  // Requirement 9.1: moving to Red notifies the authorized stakeholders.
  const notified = db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE project_id = ? AND event_type = 'PROJECT_TURNED_RED'")
    .get(target.id).n;
  assert.ok(notified > 0);
});

test('a rationale that is too short is rejected', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.kale@mmcoe.example');
  const target = project('MMCOE-CSE-2026-01');

  const result = await mentor.post(`/api/projects/${target.id}/status`, {
    newStatus: 'YELLOW',
    rationale: 'slow',
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'BAD_REQUEST');
});
