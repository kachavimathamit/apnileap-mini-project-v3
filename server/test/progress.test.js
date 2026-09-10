import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('progress');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

const project = (code) => db.prepare('SELECT * FROM projects WHERE code = ?').get(code);

/**
 * Requirements sections 2, 8-10, 18-19: a student's reported completion is
 * never the official value. It only becomes official once a reviewer
 * approves it, and every intermediate state is a real, persisted row - not a
 * value mutated in place.
 */
test('a student can save a draft, and it does not appear as an official update', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');
  const before = target.completion_percentage;

  const draft = await student.post(`/api/projects/${target.id}/progress`, {
    completionPercentage: 40,
    workCompleted: 'SPI driver implemented.',
    submitNow: false,
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.submission.status, 'DRAFT');

  const stillOfficial = project('KLE-CSE-2026-04').completion_percentage;
  assert.equal(stillOfficial, before, 'a draft must never change the official completion value');
});

test('a mentor without progress:submit rights on a project cannot submit for a different institute’s project', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example'); // KLE only
  const foreign = project('MMCOE-CSE-2026-01');

  const attempt = await mentor.post(`/api/projects/${foreign.id}/progress`, {
    completionPercentage: 50, submitNow: false,
  });
  assert.equal(attempt.status, 404);
});

test('the full submit -> changes requested -> resubmit -> approve cycle persists in the database', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const reviewer = createClient(baseUrl);
  await reviewer.login('mentor.hegde@kletech.example'); // holds progress:review as a mentor
  const target = project('KLE-CSE-2026-04');

  // 1. Student submits.
  const submitted = await student.post(`/api/projects/${target.id}/progress`, {
    completionPercentage: 45,
    workCompleted: 'Bench harness assembled.',
    workPlannedNext: 'Firmware timing validation.',
    submitNow: true,
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.submission.status, 'PENDING_REVIEW');
  const submissionId = submitted.body.submission.id;

  // It is now visible in the reviewer's pending-review queue.
  const queue = await reviewer.get('/api/me/pending-reviews');
  assert.ok(queue.body.submissions.some((s) => s.id === submissionId));

  // 2. Reviewer requests changes - a comment is mandatory.
  const noComment = await reviewer.post(`/api/projects/${target.id}/progress/${submissionId}/decision`, {
    decision: 'CHANGES_REQUESTED',
  });
  assert.equal(noComment.status, 400);

  const changes = await reviewer.post(`/api/projects/${target.id}/progress/${submissionId}/decision`, {
    decision: 'CHANGES_REQUESTED',
    comment: 'Please attach the bench test log before this can be approved.',
  });
  assert.equal(changes.status, 200);
  assert.equal(changes.body.submission.status, 'CHANGES_REQUESTED');

  const stillOfficialAfterChangesRequested = project('KLE-CSE-2026-04').completion_percentage;

  // 3. Student edits the same submission and resubmits.
  const resubmit = await student.patch(`/api/projects/${target.id}/progress/${submissionId}`, {
    completionPercentage: 48,
    evidence: 'Bench test log attached, dated today.',
    submitNow: true,
  });
  assert.equal(resubmit.status, 200, JSON.stringify(resubmit.body));
  assert.equal(resubmit.body.submission.status, 'PENDING_REVIEW');
  assert.equal(resubmit.body.submission.completion_percentage, 48);

  assert.equal(
    project('KLE-CSE-2026-04').completion_percentage,
    stillOfficialAfterChangesRequested,
    'the official value must not move until approval, no matter how many rounds happen first',
  );

  // 4. Reviewer approves - only now does the official value change.
  const approved = await reviewer.post(`/api/projects/${target.id}/progress/${submissionId}/decision`, {
    decision: 'APPROVED',
    comment: 'Looks good.',
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.submission.status, 'APPROVED');

  const official = project('KLE-CSE-2026-04');
  assert.equal(official.completion_percentage, 48);

  // 5. This project must survive logout / new login (real persistence, not UI state).
  const freshSession = createClient(baseUrl);
  await freshSession.login('platform.admin@apnileap.example');
  const rechecked = await freshSession.get(`/api/projects/${target.id}`);
  assert.equal(rechecked.body.project.completion_percentage, 48);
});

test('an approved submission cannot be edited or deleted, at the database layer', async () => {
  const approvedRow = db
    .prepare("SELECT * FROM progress_submissions WHERE status = 'APPROVED' LIMIT 1")
    .get();
  assert.ok(approvedRow, 'the previous test must have produced an approved row');

  assert.throws(
    () => db.prepare("UPDATE progress_submissions SET completion_percentage = 99 WHERE id = ?").run(approvedRow.id),
    /cannot be edited/,
  );
  assert.throws(
    () => db.prepare('DELETE FROM progress_submissions WHERE id = ?').run(approvedRow.id),
    /only a draft or changes-requested submission may be deleted/,
  );
});

test('a student cannot decide on their own submission', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');

  const draft = await student.post(`/api/projects/${target.id}/progress`, {
    completionPercentage: 55, submitNow: true,
  });
  assert.equal(draft.status, 201);

  const attempt = await student.post(
    `/api/projects/${target.id}/progress/${draft.body.submission.id}/decision`,
    { decision: 'APPROVED' },
  );
  assert.equal(attempt.status, 403);
});

test('only a draft may be deleted, never a submitted or decided version', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');

  const draft = await student.post(`/api/projects/${target.id}/progress`, {
    completionPercentage: 10, submitNow: false,
  });
  const deleted = await student.del(`/api/projects/${target.id}/progress/${draft.body.submission.id}`);
  assert.equal(deleted.status, 200);

  const submitted = await student.post(`/api/projects/${target.id}/progress`, {
    completionPercentage: 60, submitNow: true,
  });
  const blocked = await student.del(`/api/projects/${target.id}/progress/${submitted.body.submission.id}`);
  assert.equal(blocked.status, 409);
});

test('a read-only stakeholder can see progress history but cannot submit or review it', async () => {
  const observer = createClient(baseUrl);
  await observer.login('trustee@apnileap.example');
  const target = project('MMCOE-CSE-2026-01');

  const list = await observer.get(`/api/projects/${target.id}/progress`);
  assert.equal(list.status, 200);

  const attempt = await observer.post(`/api/projects/${target.id}/progress`, {
    completionPercentage: 10, submitNow: false,
  });
  assert.equal(attempt.status, 403);
});
