import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('foundation');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

const institute = (code) => db.prepare('SELECT * FROM institutes WHERE code = ?').get(code);
const department = (code, instituteCode) =>
  db.prepare('SELECT d.* FROM departments d JOIN institutes i ON i.id = d.institute_id WHERE d.code = ? AND i.code = ?')
    .get(code, instituteCode);
const project = (code) => db.prepare('SELECT * FROM projects WHERE code = ?').get(code);
const theme = (code) => db.prepare('SELECT * FROM project_themes WHERE code = ?').get(code);
const userByEmail = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

/** Full ratings object covering every one of a gate's rubric criteria, all set to `rating`. */
function fullRatings(criteria, rating) {
  return Object.fromEntries(criteria.map((c) => [c.criterion_name, rating]));
}

/** The platform-wide catalog is visible to anyone who can view projects. */
test('the ten-theme catalog and the gate/stage/sprint/calendar reference catalog are seeded correctly', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');

  const themes = await mentor.get('/api/themes');
  assert.equal(themes.status, 200);
  assert.ok(themes.body.themes.length >= 10);
  const rbac = themes.body.themes.find((t) => t.code === 'RBAC-WORKFLOW');
  assert.ok(rbac);
  assert.equal(rbac.foundational_courses.length, 6);
  assert.ok(rbac.minimum_evidence.includes('ER Diagram'));

  const gates = await mentor.get('/api/gates');
  assert.equal(gates.status, 200);
  assert.equal(gates.body.gates.length, 5);
  assert.equal(gates.body.stages.length, 8);
  assert.equal(gates.body.sprints.length, 3);

  // Handbook Sec 1.12: 5 + 10 + 10 + 15 + 10 = 50 marks total, not 100.
  const marksByGate = Object.fromEntries(gates.body.gates.map((g) => [g.id, g.marks_weight]));
  assert.deepEqual(marksByGate, { GATE_0: 5, GATE_1: 10, GATE_2: 10, GATE_3: 15, GATE_4: 10 });
  assert.equal(Object.values(marksByGate).reduce((a, b) => a + b, 0), 50);

  const gate0 = gates.body.gates.find((g) => g.id === 'GATE_0');
  assert.equal(gate0.criteria.length, 4);
  assert.equal(gate0.criteria.reduce((sum, c) => sum + c.weight_marks, 0), 5);
  assert.ok(gate0.criteria[0].level_descriptors['5']);

  const s0 = gates.body.stages.find((s) => s.id === 'S0');
  assert.equal(s0.name, 'Problem Definition and Need Identification');
  assert.equal(s0.is_sequential_foundation, 1);
  assert.ok(s0.evidence_checklist.includes('Problem Statement'));
  assert.deepEqual(s0.gates, ['GATE_0']);

  const s6 = gates.body.stages.find((s) => s.id === 'S6');
  assert.deepEqual(s6.gates.sort(), ['GATE_3', 'GATE_4']);

  const calendar = await mentor.get('/api/gates/calendar');
  assert.equal(calendar.status, 200);
  assert.equal(calendar.body.weeks.length, 17);
  const week2 = calendar.body.weeks.find((w) => w.week_number === 2);
  assert.equal(week2.gate_id, 'GATE_0');
  const week6 = calendar.body.weeks.find((w) => w.week_number === 6);
  assert.equal(week6.is_protected_week, 1);
});

/**
 * The whole Foundation Integration extension unlocks only after a project
 * has an allocated guide - theme, engines, gate reviews and weekly
 * check-ins are all rejected with 409 before that, per docs/DATABASE-
 * DESIGN.txt Section 9.0.
 */
test('theme, engines, gate reviews and check-ins stay locked until a guide is allocated', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example');
  const cse = department('CSE', 'KLE');

  const created = await admin.post('/api/projects', {
    departmentId: cse.id, code: 'KLE-CSE-2026-90', title: 'Unguided project for lock testing',
    academicYear: '2025-26', semester: 'Odd',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.project.id;
  const rbac = theme('RBAC-WORKFLOW');

  const themeAttempt = await admin.patch(`/api/projects/${projectId}/theme`, { themeId: rbac.id });
  assert.equal(themeAttempt.status, 409);

  const engineAttempt = await admin.post(`/api/projects/${projectId}/engines`, {
    code: 'E1', name: 'Scheduler', responsibility: 'Owns job scheduling for the lab.',
  });
  assert.equal(engineAttempt.status, 409);

  const checkinAttempt = await admin.post(`/api/projects/${projectId}/weekly-checkins`, {
    processDisciplineNotes: 'n/a',
  });
  assert.equal(checkinAttempt.status, 409);

  // Allocate the guide, then the same theme assignment succeeds.
  const mentorId = userByEmail('mentor.hegde@kletech.example');
  const assign = await admin.post(`/api/projects/${projectId}/assign-guide`, { userId: mentorId });
  assert.equal(assign.status, 201, JSON.stringify(assign.body));

  const themeNow = await admin.patch(`/api/projects/${projectId}/theme`, { themeId: rbac.id });
  assert.equal(themeNow.status, 200, JSON.stringify(themeNow.body));
  assert.equal(themeNow.body.project.theme_id, rbac.id);
  assert.equal(themeNow.body.project.theme_confirmed_by_name, 'Shruti Kulkarni');
});

/** A theme scoped to one institute's own catalog cannot be assigned to a different institute's project. */
test('an institute-owned custom theme cannot cross institutes', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.mmcoe@mmcoe.example');
  const mmcoe = institute('MMCOE');

  const customTheme = await admin.post('/api/themes', {
    instituteId: mmcoe.id, code: 'MMCOE-CUSTOM-1', title: 'MMCOE-only custom theme',
  });
  assert.equal(customTheme.status, 201, JSON.stringify(customTheme.body));

  const kleAdmin = createClient(baseUrl);
  await kleAdmin.login('admin.kle@kletech.example');
  const target = project('KLE-CSE-2026-01');
  const attempt = await kleAdmin.patch(`/api/projects/${target.id}/theme`, { themeId: customTheme.body.theme.id });
  assert.equal(attempt.status, 400);
});

/**
 * Engine decomposition against the Handbook's 13-field template: a guide's
 * complete engine is approved immediately; an incomplete one - even from
 * the guide - stays PROPOSED (Sec 1.9.1's validity test), and a student
 * may only propose one naming themselves as owner.
 */
test('engine decomposition: the validity-test fields gate APPROVED status, and cycles are rejected', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-04'); // has a linked student member (student.team4)

  await mentor.patch(`/api/projects/${target.id}/theme`, { themeId: theme('RBAC-WORKFLOW').id });
  const studentMember = db
    .prepare("SELECT id FROM project_members WHERE project_id = ? AND member_role = 'STUDENT' AND user_id IS NOT NULL")
    .get(target.id);

  // Missing failure case / KPI / etc - not enough to be auto-approved.
  const incomplete = await mentor.post(`/api/projects/${target.id}/engines`, {
    code: 'E0', name: 'Half-Specified Engine', responsibility: 'Owns something, vaguely.',
  });
  assert.equal(incomplete.status, 201, JSON.stringify(incomplete.body));
  assert.equal(incomplete.body.engine.status, 'PROPOSED');

  const approveIncomplete = await mentor.patch(`/api/projects/${target.id}/engines/${incomplete.body.engine.id}`, { status: 'APPROVED' });
  assert.equal(approveIncomplete.status, 400);

  const e1 = await mentor.post(`/api/projects/${target.id}/engines`, {
    code: 'E1', name: 'Access Control Engine', responsibility: 'Owns role/permission evaluation on every request.',
    primaryCourse: 'Operating Systems',
    inputs: 'Authenticated request + resource + action', outputs: 'Allow/deny decision, 401/403 on failure',
    internalState: 'Role DAG and effective-permission cache',
    algorithmMechanism: 'Graph traversal over the role DAG to resolve effective permissions',
    interfaceSpec: 'authorize(userId, resource, action) -> ALLOW | DENY',
    kpiTarget: 'p99 authorization latency < 10ms',
    failureCase: 'Expired session -> 401; insufficient role -> 403',
    validationMethod: 'Boundary and negative access-control test suite',
    ownerMemberId: studentMember.id,
  });
  assert.equal(e1.status, 201, JSON.stringify(e1.body));
  assert.equal(e1.body.engine.status, 'APPROVED');
  assert.equal(e1.body.engine.approved_by_name, 'Prof. Sanjay Hegde');

  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');

  const proposedByOther = await student.post(`/api/projects/${target.id}/engines`, {
    code: 'E2', name: 'Workflow Engine', responsibility: 'Owns the state-machine transitions.',
    ownerMemberId: 'someone-elses-member-id',
  });
  // A student cannot name another member as owner - the API forces self-ownership regardless.
  assert.equal(proposedByOther.status, 201, JSON.stringify(proposedByOther.body));
  assert.equal(proposedByOther.body.engine.status, 'PROPOSED');
  assert.equal(proposedByOther.body.engine.owner_member_id, studentMember.id);

  const e2Id = proposedByOther.body.engine.id;
  const completeE2 = await mentor.patch(`/api/projects/${target.id}/engines/${e2Id}`, {
    inputs: 'Transition request', outputs: 'New state or 409 on invalid transition',
    algorithmMechanism: 'Finite-state machine with a guarded transition table',
    interfaceSpec: 'transition(currentState, event) -> newState | 409',
    kpiTarget: '100% invalid transitions rejected', failureCase: 'Invalid transition -> 409',
  });
  assert.equal(completeE2.status, 200, JSON.stringify(completeE2.body));

  const approveE2 = await mentor.patch(`/api/projects/${target.id}/engines/${e2Id}`, { status: 'APPROVED' });
  assert.equal(approveE2.status, 200, JSON.stringify(approveE2.body));
  assert.equal(approveE2.body.engine.status, 'APPROVED');

  const dep = await mentor.post(`/api/projects/${target.id}/engines/${e2Id}/dependencies`, {
    dependsOnEngineId: e1.body.engine.id, note: 'Workflow transitions need an access decision first.',
  });
  assert.equal(dep.status, 201, JSON.stringify(dep.body));

  // E1 -> depends on E2 would close a 2-cycle (E2 already depends on E1).
  const cycle = await mentor.post(`/api/projects/${target.id}/engines/${e1.body.engine.id}/dependencies`, {
    dependsOnEngineId: e2Id,
  });
  assert.equal(cycle.status, 400);
  assert.match(cycle.body.error.message, /cycle/i);
});

/**
 * The formal Gate 0-4 model: gates unlock in sequence, a gate review needs
 * at least one owned engine, marks are recorded per student against the
 * gate's rubric criteria, and a passed gate becomes immutable.
 */
test('gate reviews open in sequence, score per student against the rubric, and lock once passed', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01'); // guided by mentor.hegde; reachable by coach as REVIEWER

  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');

  const gatesBefore = await mentor.get(`/api/projects/${target.id}/gates`);
  const gate0 = gatesBefore.body.gates.find((g) => g.id === 'GATE_0');
  const gate1 = gatesBefore.body.gates.find((g) => g.id === 'GATE_1');
  assert.equal(gate0.criteria.length, 4);
  assert.equal(gate1.criteria.length, 3);
  assert.equal(gate1.criteria.reduce((s, c) => s + c.weight_marks, 0), 10);

  const noEngine = await reviewer.post(`/api/projects/${target.id}/gates/GATE_0/reviews`, {
    decision: 'PASS', comments: 'Attempting without any engine on record yet.',
    studentScores: [{ memberId: 'irrelevant', criterionRatings: fullRatings(gate0.criteria, 5) }],
  });
  assert.equal(noEngine.status, 409);

  await mentor.patch(`/api/projects/${target.id}/theme`, { themeId: theme('SEARCH-ENGINE').id });
  const studentMember = db
    .prepare("SELECT id FROM project_members WHERE project_id = ? AND member_role = 'STUDENT'")
    .get(target.id);
  const engine = await mentor.post(`/api/projects/${target.id}/engines`, {
    code: 'E1', name: 'Indexer Engine', responsibility: 'Owns building and persisting the inverted index.',
    inputs: 'Document stream', outputs: 'Posting-list index on disk',
    algorithmMechanism: 'Hash-map inverted index with tf-idf ranking',
    interfaceSpec: 'index(doc) -> void; search(query) -> ranked results',
    kpiTarget: 'Query latency < 200ms at 3x baseline load', failureCase: 'Mid-write crash -> index recovers on restart',
    ownerMemberId: studentMember.id,
  });
  assert.equal(engine.status, 201, JSON.stringify(engine.body));
  assert.equal(engine.body.engine.status, 'APPROVED');

  const skipAhead = await reviewer.post(`/api/projects/${target.id}/gates/GATE_1/reviews`, {
    decision: 'PASS', comments: 'Trying to skip Gate 0 entirely.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: fullRatings(gate1.criteria, 5) }],
  });
  assert.equal(skipAhead.status, 409);
  assert.match(skipAhead.body.error.message, /Gate 0/);

  const badCriterion = await reviewer.post(`/api/projects/${target.id}/gates/GATE_0/reviews`, {
    decision: 'PASS', comments: 'Using a criterion name that does not belong to Gate 0.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: { 'Not A Real Criterion': 5 } }],
  });
  assert.equal(badCriterion.status, 400);

  const gate0Pass = await reviewer.post(`/api/projects/${target.id}/gates/GATE_0/reviews`, {
    decision: 'PASS', comments: 'Problem, stakeholders and scope are well evidenced.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: fullRatings(gate0.criteria, 4), vivaNotes: 'Confident, independent explanation.' }],
    evidence: [{ stageId: 'S0', checklistItem: 'Stakeholder Identification / Need Table', evidenceRefType: 'TEXT_NOTE', note: 'Reviewed in person.' }],
  });
  assert.equal(gate0Pass.status, 201, JSON.stringify(gate0Pass.body));
  assert.equal(gate0Pass.body.gateReview.next_gate_unlocked, 1);
  // 4 criteria x (4/5 x 1.25) = 4.0 marks out of 5.
  assert.equal(gate0Pass.body.scores[0].marks_awarded, 4);

  const rePass = await reviewer.post(`/api/projects/${target.id}/gates/GATE_0/reviews`, {
    decision: 'PASS', comments: 'Trying to re-review an already-passed gate.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: fullRatings(gate0.criteria, 5) }],
  });
  assert.equal(rePass.status, 409);

  const gate1Resubmit = await reviewer.post(`/api/projects/${target.id}/gates/GATE_1/reviews`, {
    decision: 'RESUBMIT', comments: 'Acceptance criteria are missing for two functional requirements.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: fullRatings(gate1.criteria, 2) }],
  });
  assert.equal(gate1Resubmit.status, 201);
  assert.equal(gate1Resubmit.body.gateReview.next_gate_unlocked, 0);
  assert.equal(gate1Resubmit.body.gateReview.attempt_number, 1);

  const stillBlocked = await reviewer.post(`/api/projects/${target.id}/gates/GATE_2/reviews`, {
    decision: 'PASS', comments: 'Gate 1 has not been passed yet.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: {} }],
  });
  assert.equal(stillBlocked.status, 409);

  const gate1Retry = await reviewer.post(`/api/projects/${target.id}/gates/GATE_1/reviews`, {
    decision: 'PASS', comments: 'Requirements were revised with full acceptance criteria.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: fullRatings(gate1.criteria, 5) }],
  });
  assert.equal(gate1Retry.status, 201);
  assert.equal(gate1Retry.body.gateReview.attempt_number, 2);
  assert.equal(gate1Retry.body.scores[0].marks_awarded, 10); // full marks on all 3 criteria

  const ladder = await mentor.get(`/api/projects/${target.id}/gates`);
  assert.equal(ladder.status, 200);
  const g2 = ladder.body.gates.find((g) => g.id === 'GATE_2');
  assert.equal(g2.unlocked, true);

  // A Faculty Mentor (guide) does not hold the Reviewer's gate-review capability.
  const mentorAttempt = await mentor.post(`/api/projects/${target.id}/gates/GATE_2/reviews`, {
    decision: 'PASS', comments: 'A guide should not be able to conduct the formal gate review.',
    studentScores: [{ memberId: studentMember.id, criterionRatings: {} }],
  });
  assert.equal(mentorAttempt.status, 403);
});

/** Weekly check-ins are logged only by the project's own current guide. */
test('weekly check-ins are logged by the current guide only', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01'); // themed and guided by mentor.hegde from earlier tests

  const logged = await mentor.post(`/api/projects/${target.id}/weekly-checkins`, {
    processDisciplineNotes: 'Reviewed this week\'s commits against the SRS baseline.',
    gitCommitsReviewed: '5 commits, all dated after the design doc.',
    flags: [],
  });
  assert.equal(logged.status, 201, JSON.stringify(logged.body));
  assert.equal(logged.body.checkin.guide_name, 'Prof. Sanjay Hegde');

  // The department head reaches this project but was never granted
  // project:log_checkin - only a guide (or staff/admin) may log a check-in.
  const head = createClient(baseUrl);
  await head.login('head.cse@kletech.example');
  const denied = await head.post(`/api/projects/${target.id}/weekly-checkins`, {
    processDisciplineNotes: 'Should not be allowed.',
  });
  assert.equal(denied.status, 403);

  const list = await mentor.get(`/api/projects/${target.id}/weekly-checkins`);
  assert.equal(list.status, 200);
  assert.equal(list.body.checkins.length, 1);
});
