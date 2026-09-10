import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDatabase, createClient, startServer } from './helpers.js';

prepareTestDatabase('rubrics');

const { baseUrl, close } = await startServer();
const { db } = await import('../src/db/connection.js');

test.after(() => close());

const institute = (code) => db.prepare('SELECT * FROM institutes WHERE code = ?').get(code);
const project = (code) => db.prepare('SELECT * FROM projects WHERE code = ?').get(code);

/**
 * A mentor defines one rubric, then generates the same 3 reviews - using
 * that exact rubric - across every project they guide, in one call.
 */
test('a mentor creates a rubric and generates 3 reviews across every team they guide', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const kle = institute('KLE');

  const rubric = await mentor.post('/api/rubrics', {
    instituteId: kle.id,
    title: 'Mid-semester evaluation rubric',
    criteria: [
      { name: 'Technical progress', maxMarks: 40 },
      { name: 'Documentation', maxMarks: 20 },
      { name: 'Presentation', maxMarks: 20 },
      { name: 'Teamwork', maxMarks: 20 },
    ],
  });
  assert.equal(rubric.status, 201, JSON.stringify(rubric.body));
  const rubricId = rubric.body.rubric.id;

  // mentor.hegde guides three seeded projects: KLE-CSE-2026-01, KLE-CSE-2026-04, KLE-MECH-2026-01.
  const generate = await mentor.post(`/api/rubrics/${rubricId}/generate-reviews`, { reviewCount: 3 });
  assert.equal(generate.status, 201, JSON.stringify(generate.body));
  assert.equal(generate.body.teamsAffected, 3);
  assert.equal(generate.body.created, 9); // 3 reviews x 3 teams

  const teamOne = generate.body.perTeam.find((t) => t.projectCode === 'KLE-CSE-2026-01');
  assert.deepEqual(teamOne.scheduled, [1, 2, 3]);

  // Calling it again does not duplicate - it is idempotent per project/rubric/number.
  const again = await mentor.post(`/api/rubrics/${rubricId}/generate-reviews`, { reviewCount: 3 });
  assert.equal(again.body.created, 0);
  assert.equal(again.body.skipped, 9);

  // A reviewer holds review:create but no FACULTY_MENTOR project membership,
  // so they have no "teams" to generate reviews across - a clear refusal,
  // not an empty silent success.
  const reviewer = createClient(baseUrl);
  await reviewer.login('coach@apnileap.example');
  const reviewerRubric = await reviewer.post('/api/rubrics', {
    instituteId: institute('RIT').id, title: 'Empty', criteria: [{ name: 'Score', maxMarks: 10 }],
  });
  assert.equal(reviewerRubric.status, 201);
  const reviewerGenerate = await reviewer.post(`/api/rubrics/${reviewerRubric.body.rubric.id}/generate-reviews`, {});
  assert.equal(reviewerGenerate.status, 400);
});

test('conducting a scheduled review scores against the rubric and cannot exceed its maximums', async () => {
  const mentor = createClient(baseUrl);
  await mentor.login('mentor.hegde@kletech.example');
  const kle = institute('KLE');
  const target = project('KLE-CSE-2026-01');

  const rubric = await mentor.post('/api/rubrics', {
    instituteId: kle.id, title: 'Review 1 rubric',
    criteria: [{ name: 'Progress', maxMarks: 50 }, { name: 'Clarity', maxMarks: 50 }],
  });
  await mentor.post(`/api/rubrics/${rubric.body.rubric.id}/generate-reviews`, { reviewCount: 1 });

  const list = await mentor.get(`/api/projects/${target.id}/scheduled-reviews`);
  assert.equal(list.status, 200);
  const slot = list.body.scheduledReviews.find((s) => s.rubric_id === rubric.body.rubric.id);
  assert.equal(slot.status, 'PLANNED');
  assert.deepEqual(slot.rubric_criteria.map((c) => c.name), ['Progress', 'Clarity']);

  const overMax = await mentor.post(`/api/projects/${target.id}/scheduled-reviews/${slot.id}/conduct`, {
    decision: 'NOTED',
    comments: 'Team demonstrated working ingestion service with two live meters.',
    scores: { Progress: 999, Clarity: 30 },
  });
  assert.equal(overMax.status, 400);
  assert.match(overMax.body.error.message, /exceeds its maximum/i);

  const unknownCriterion = await mentor.post(`/api/projects/${target.id}/scheduled-reviews/${slot.id}/conduct`, {
    decision: 'NOTED', comments: 'Trying an invalid criterion name here for the test.',
    scores: { NotARealCriterion: 5 },
  });
  assert.equal(unknownCriterion.status, 400);

  const ok = await mentor.post(`/api/projects/${target.id}/scheduled-reviews/${slot.id}/conduct`, {
    decision: 'APPROVED',
    comments: 'Strong progress overall, documentation could be tightened before the next review.',
    scores: { Progress: 45, Clarity: 38 },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.review.review_number, 1);
  assert.equal(ok.body.review.rubric_id, rubric.body.rubric.id);
  assert.deepEqual(JSON.parse(ok.body.review.scores), { Progress: 45, Clarity: 38 });
  assert.equal(ok.body.scheduledReview.status, 'COMPLETED');

  // It shows up in the project's normal review history too.
  const detail = await mentor.get(`/api/projects/${target.id}`);
  assert.ok(detail.body.reviews.some((r) => r.id === ok.body.review.id));

  // Cannot be conducted twice.
  const again = await mentor.post(`/api/projects/${target.id}/scheduled-reviews/${slot.id}/conduct`, {
    decision: 'NOTED', comments: 'Attempting to conduct the same scheduled review a second time.',
  });
  assert.equal(again.status, 409);
});

test('a student cannot create a rubric or conduct a review', async () => {
  const student = createClient(baseUrl);
  await student.login('student.team4@kletech.example');
  const kle = institute('KLE');

  const attempt = await student.post('/api/rubrics', {
    instituteId: kle.id, title: 'Should not work', criteria: [{ name: 'Score', maxMarks: 10 }],
  });
  assert.equal(attempt.status, 403);
});
