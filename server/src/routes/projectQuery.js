const ALLOWED_SORTS = ['severity', 'oldest_update', 'next_milestone', 'mentor', 'name', 'completion'];
const ALLOWED_STATUSES = ['GREEN', 'YELLOW', 'RED'];

/** Normalises the department/institute project-list query string (FR 5.4). */
export function parseProjectQuery(query = {}) {
  const filters = {};

  if (ALLOWED_STATUSES.includes(query.status)) filters.status = query.status;
  if (typeof query.semester === 'string' && query.semester) filters.semester = query.semester.slice(0, 40);
  if (typeof query.academicYear === 'string' && query.academicYear) {
    filters.academicYear = query.academicYear.slice(0, 20);
  }
  if (typeof query.mentorUserId === 'string' && query.mentorUserId) {
    filters.mentorUserId = query.mentorUserId.slice(0, 64);
  }
  if (typeof query.search === 'string' && query.search.trim()) {
    filters.search = query.search.trim().slice(0, 100);
  }
  if (query.overdueActions === 'true') filters.overdueActions = true;
  if (query.stale === 'true') filters.stale = true;
  if (query.awaitingReview === 'true') filters.awaitingReview = true;

  const sort = ALLOWED_SORTS.includes(query.sort) ? query.sort : 'severity';
  return { filters, sort };
}
