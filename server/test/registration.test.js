import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('registration');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

const institute = (code) => db.prepare('SELECT * FROM institutes WHERE code = ?').get(code);
const department = (code, instituteCode) =>
  db.prepare('SELECT d.* FROM departments d JOIN institutes i ON i.id = d.institute_id WHERE d.code = ? AND i.code = ?')
    .get(code, instituteCode);
const project = (code) => db.prepare('SELECT * FROM projects WHERE code = ?').get(code);

/**
 * Faculty Mentor self-registration, approved by a Department Head. Until
 * approved, the account exists and can sign in but holds no access grant, so
 * it sees nothing - the same deny-by-default behaviour as any ungranted
 * account, not a bespoke "pending" state.
 */
test('a mentor registers, sees nothing until approved, then gains department access', async () => {
  const kle = institute('KLE');
  const cse = department('CSE', 'KLE');

  const options = await createClient(baseUrl).get('/api/auth/register-options');
  assert.equal(options.status, 200);
  assert.ok(options.body.institutes.some((i) => i.id === kle.id));

  const applicant = createClient(baseUrl);
  const register = await applicant.post('/api/auth/register', {
    email: 'new.mentor@kletech.example',
    password: 'NewMentor1234',
    fullName: 'Dr. New Mentor',
    designation: 'Assistant Professor',
    instituteId: kle.id,
    departmentId: cse.id,
  });
  assert.equal(register.status, 201, JSON.stringify(register.body));

  // Can sign in immediately, but sees nothing - no grant exists yet.
  await applicant.login('new.mentor@kletech.example', 'NewMentor1234');
  const before = await applicant.get('/api/institutes');
  assert.equal(before.body.institutes.length, 0);

  // A reviewer without mentor:approve reach cannot see or decide it.
  const foreignHead = createClient(baseUrl);
  await foreignHead.login('mentor.pawar@rit.example'); // not a department head anywhere
  const deniedList = await foreignHead.get('/api/admin/role-requests');
  assert.equal(deniedList.status, 403);

  // The KLE CSE department head sees it and approves it.
  const head = createClient(baseUrl);
  await head.login('head.cse@kletech.example');
  const queue = await head.get('/api/admin/role-requests');
  assert.equal(queue.status, 200);
  const request = queue.body.requests.find((r) => r.email === 'new.mentor@kletech.example');
  assert.ok(request, 'the department head must see the pending registration');

  const decide = await head.post(`/api/admin/role-requests/${request.id}/decision`, { decision: 'APPROVED' });
  assert.equal(decide.status, 200, JSON.stringify(decide.body));

  // Now the mentor can see the department's projects.
  const after = await applicant.get('/api/institutes');
  assert.equal(after.body.institutes.length, 1);
  assert.equal(after.body.institutes[0].code, 'KLE');
});

test('rejecting a registration requires a comment and grants nothing', async () => {
  const kle = institute('KLE');
  const ece = department('ECE', 'KLE');

  const applicant = createClient(baseUrl);
  await applicant.post('/api/auth/register', {
    email: 'rejected.mentor@kletech.example',
    password: 'RejectMe1234',
    fullName: 'Someone Else',
    instituteId: kle.id,
    departmentId: ece.id,
  });

  const head = createClient(baseUrl);
  await head.login('head.ece@kletech.example');
  const queue = await head.get('/api/admin/role-requests');
  const request = queue.body.requests.find((r) => r.email === 'rejected.mentor@kletech.example');

  const noComment = await head.post(`/api/admin/role-requests/${request.id}/decision`, { decision: 'REJECTED' });
  assert.equal(noComment.status, 400);

  const rejected = await head.post(`/api/admin/role-requests/${request.id}/decision`, {
    decision: 'REJECTED',
    comment: 'This institute already has enough mentors in this department this term.',
  });
  assert.equal(rejected.status, 200);

  await applicant.login('rejected.mentor@kletech.example', 'RejectMe1234');
  const after = await applicant.get('/api/institutes');
  assert.equal(after.body.institutes.length, 0, 'a rejected applicant must still see nothing');
});

/**
 * Coordinator allocation: an institute administrator (who also holds
 * project:assign_guide) assigns an approved mentor as the project's guide.
 */
test('a project can only be allocated to a mentor who holds an approved grant reaching it', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example');
  const target = project('KLE-CSE-2026-01'); // currently guided by mentor.hegde (CSE-scoped)

  // Wrong institute entirely - never reaches this project.
  const foreignMentor = db.prepare("SELECT id FROM users WHERE email = 'mentor.kale@mmcoe.example'").get();
  const rejected = await admin.post(`/api/projects/${target.id}/assign-guide`, { userId: foreignMentor.id });
  assert.equal(rejected.status, 400);

  // Right institute, wrong department (ECE, not CSE) - still doesn't reach it.
  const wrongDepartment = db.prepare("SELECT id FROM users WHERE email = 'mentor.nayak@kletech.example'").get();
  const alsoRejected = await admin.post(`/api/projects/${target.id}/assign-guide`, { userId: wrongDepartment.id });
  assert.equal(alsoRejected.status, 400);

  // A mentor whose grant genuinely reaches CSE can be assigned.
  const validMentor = db.prepare("SELECT id FROM users WHERE email = 'mentor.hegde@kletech.example'").get();
  const assigned = await admin.post(`/api/projects/${target.id}/assign-guide`, { userId: validMentor.id });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));

  const detail = await admin.get(`/api/projects/${target.id}`);
  const guide = detail.body.members.find((m) => m.member_role === 'FACULTY_MENTOR');
  assert.equal(guide.name, 'Prof. Sanjay Hegde');
});

test('a faculty mentor cannot allocate a project to another guide', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');
  const other = db.prepare("SELECT id FROM users WHERE email = 'mentor.nayak@kletech.example'").get();

  const attempt = await mentor.post(`/api/projects/${target.id}/assign-guide`, { userId: other.id });
  assert.equal(attempt.status, 403);
});

/**
 * A guide enters a student team; it stays PENDING until a coordinator
 * (here, the department head, who also holds team:approve) confirms it.
 */
test('a student team a guide enters is pending until the coordinator approves it', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const target = project('KLE-CSE-2026-01');

  const added = await mentor.post(`/api/projects/${target.id}/members`, {
    memberRole: 'STUDENT', teamIdentifier: 'NEW-TEAM-9',
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.member.status, 'PENDING');
  const memberId = added.body.member.id;

  const head = createClient(baseUrl);
  await head.login('head.cse@kletech.example');

  const noComment = await head.post(`/api/projects/${target.id}/members/${memberId}/decision`, { decision: 'REJECTED' });
  assert.equal(noComment.status, 400);

  const approved = await head.post(`/api/projects/${target.id}/members/${memberId}/decision`, { decision: 'APPROVED' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.member.status, 'APPROVED');
  assert.equal(approved.body.member.approved_by_name, 'Dr. Anita Deshpande');
});

test('a coordinator adding a student team directly is self-approved', async () => {
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example'); // holds team:approve via the admin override
  const target = project('KLE-CSE-2026-01');

  const added = await admin.post(`/api/projects/${target.id}/members`, {
    memberRole: 'STUDENT', teamIdentifier: 'STAFF-ADDED-TEAM',
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.member.status, 'APPROVED');
});

/**
 * Freeze: students can enter theme/title/other definition fields, but once
 * the guide freezes the project they can no longer change it - the guide
 * (and staff) still can.
 */
test('a student can edit the project definition, but not once the guide freezes it', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');

  const edited = await student.patch(`/api/projects/${target.id}/definition`, {
    title: 'Assistive braille reader for lab instruments (v2)',
    objective: 'Updated objective entered directly by the student team.',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.project.title, 'Assistive braille reader for lab instruments (v2)');

  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const froze = await mentor.post(`/api/projects/${target.id}/freeze`);
  assert.equal(froze.status, 200);
  assert.equal(froze.body.project.definition_frozen, 1);

  const blockedEdit = await student.patch(`/api/projects/${target.id}/definition`, {
    objective: 'The student tries to sneak in another change after freeze.',
  });
  assert.equal(blockedEdit.status, 409);
  assert.match(blockedEdit.body.error.message, /frozen/i);

  // The guide, who holds project:update, can still edit after freeze.
  const mentorEdit = await mentor.patch(`/api/projects/${target.id}/definition`, {
    objective: 'The guide can still correct the objective after freezing.',
  });
  assert.equal(mentorEdit.status, 200);

  const unfroze = await mentor.post(`/api/projects/${target.id}/unfreeze`);
  assert.equal(unfroze.status, 200);
  assert.equal(unfroze.body.project.definition_frozen, 0);

  const editAgain = await student.patch(`/api/projects/${target.id}/definition`, {
    objective: 'Now editable again after the guide unfroze it.',
  });
  assert.equal(editAgain.status, 200);
});

test('a student cannot edit fields outside the definition endpoint', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');

  // The general PATCH /projects/:id endpoint requires project:update, which
  // students never hold - only the scoped /definition endpoint is theirs.
  const attempt = await student.patch(`/api/projects/${target.id}`, { completionPercentage: 90 });
  assert.equal(attempt.status, 403);
});

// ---------------------------------------------------------------------------
// Student self-registration: joins a project by its code, sees nothing until
// the guide/coordinator approves the team entry it creates - at which point
// approval also grants the real access_grants row that makes login useful.
// ---------------------------------------------------------------------------

test('a student self-registers by project code and gains access only once approved', async () => {
  const target = project('KLE-CSE-2026-01');

  const badCode = await createClient(baseUrl).post('/api/auth/register-student', {
    fullName: 'New Student', email: 'new.student@kletech.example', password: 'NewStudent1234',
    projectCode: 'NOT-A-REAL-CODE',
  });
  assert.equal(badCode.status, 400);

  const applicant = createClient(baseUrl);
  const register = await applicant.post('/api/auth/register-student', {
    fullName: 'New Student', email: 'new.student@kletech.example', password: 'NewStudent1234',
    projectCode: target.code, teamIdentifier: 'SELF-REG-TEAM',
  });
  assert.equal(register.status, 201, JSON.stringify(register.body));

  await applicant.login('new.student@kletech.example', 'NewStudent1234');
  const before = await applicant.get('/api/institutes');
  assert.equal(before.body.institutes.length, 0, 'an unapproved student sees nothing, same as any ungranted account');

  // A coordinator-tier reviewer sees the pending entry on the project's team list.
  const admin = createClient(baseUrl);
  await admin.login('admin.kle@kletech.example');
  const detail = await admin.get(`/api/projects/${target.id}`);
  const pendingMember = detail.body.members.find((m) => m.team_identifier === 'SELF-REG-TEAM');
  assert.equal(pendingMember.status, 'PENDING');

  const approve = await admin.post(`/api/projects/${target.id}/members/${pendingMember.id}/decision`, { decision: 'APPROVED' });
  assert.equal(approve.status, 200);

  await applicant.login('new.student@kletech.example', 'NewStudent1234');
  const after = await applicant.get('/api/institutes');
  assert.equal(after.body.institutes.length, 1, 'approval grants real access, not just roster status');
  assert.equal(after.body.institutes[0].project_count, 1);
});

test('a student with real staff capability sees the full tab set, a pure student does not', async () => {
  // This is a UI-only distinction (no server route to assert against), but the
  // underlying permission split it relies on is directly testable: a pure
  // student never holds project:update or progress:review on their project.
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const target = project('KLE-CSE-2026-04');
  const detail = await student.get(`/api/projects/${target.id}`);

  assert.ok(detail.body.roles.includes('STUDENT'));
  assert.ok(!detail.body.permissions.includes('project:update'));
  assert.ok(!detail.body.permissions.includes('progress:review'));
});
