// Shared dataset for every page in this UI-only build — mirrors
// server/db/seed.sql exactly, one array per table. There is no backend yet,
// so every page reads straight from here instead of querying a database.

const DATA = {
  colleges: [
    { cid: 1, name: 'KLETech Hubballi Campus', campus: 'Hubballi' },
    { cid: 2, name: 'KLETech Belagavi Campus', campus: 'Belagavi' },
    { cid: 3, name: 'Marathwada Mitra Mandal College of Engineering', campus: 'Pune' },
    { cid: 4, name: 'Rajarambapu Institute of Technology', campus: 'Islampur' },
    { cid: 5, name: 'College of Engineering Pune (COEB/COEP)', campus: 'Pune' },
    { cid: 6, name: 'Sangli Institute', campus: 'Sangli' },
  ],

  // Only Cid 1 (KLETech Hubballi Campus) has data below this level so far —
  // matches seed.sql, which deliberately scoped the sample rows to one college.
  schools: [
    { sid: 1, name: 'School of Computer Science & Engineering', cid: 1 },
    { sid: 2, name: 'School of Electronics & Communication Engineering', cid: 1 },
    { sid: 3, name: 'School of Mechanical Engineering', cid: 1 },
    { sid: 4, name: 'School of Civil Engineering', cid: 1 },
    { sid: 5, name: 'School of Computer Applications', cid: 1 },
  ],

  depts: [
    { did: 1, name: 'Computer Science and Engineering', sid: 1 },
    { did: 2, name: 'Electronics and Communication Engineering', sid: 2 },
    { did: 3, name: 'Mechanical Engineering', sid: 3 },
    { did: 4, name: 'Civil Engineering', sid: 4 },
    { did: 5, name: 'Computer Applications', sid: 5 },
  ],

  faculty: [
    { fid: 1, name: 'Prof. Sanjay Hegde', did: 1 },
    { fid: 2, name: 'Prof. Meera Nayak', did: 2 },
    { fid: 3, name: 'Prof. Suresh Patil', did: 3 },
    { fid: 4, name: 'Prof. Anita Deshpande', did: 4 },
    { fid: 5, name: 'Prof. Kiran Joshi', did: 5 },
  ],

  themes: [
    { tid: 1, name: 'Role-Based Workflow Management System', did: 1, fid: 1 },
    { tid: 2, name: 'Multi-Process Search Engine with Persistent Index', did: 2, fid: 2 },
    { tid: 3, name: 'Constraint-Based Timetable Scheduling System', did: 3, fid: 3 },
    { tid: 4, name: 'Transaction-Based Inventory Management System', did: 4, fid: 4 },
    { tid: 5, name: 'Peer-to-Peer File Sharing System', did: 5, fid: 5 },
  ],

  artifacts: [
    { aid: 1, name: 'Campus Lab Access Control Portal', tid: 1 },
    { aid: 2, name: 'Digital Library Search Engine', tid: 2 },
    { aid: 3, name: 'Automated Exam Timetable Generator', tid: 3 },
    { aid: 4, name: 'Hostel Inventory Management System', tid: 4 },
    { aid: 5, name: 'Peer Notes Sharing Network', tid: 5 },
  ],

  students: [
    { sid: 1, name: 'Rohan Kulkarni', aid: 1, did: 1 },
    { sid: 2, name: 'Sneha Patil', aid: 2, did: 2 },
    { sid: 3, name: 'Aditya Desai', aid: 3, did: 3 },
    { sid: 4, name: 'Priya Joshi', aid: 4, did: 4 },
    { sid: 5, name: 'Karan Shetty', aid: 5, did: 5 },
  ],
};

// ------------------------------------------------------------ lookups

const findCollege = (cid) => DATA.colleges.find((c) => c.cid === Number(cid));
const findSchool = (sid) => DATA.schools.find((s) => s.sid === Number(sid));
const findDept = (did) => DATA.depts.find((d) => d.did === Number(did));
const findFaculty = (fid) => DATA.faculty.find((f) => f.fid === Number(fid));
const findTheme = (tid) => DATA.themes.find((t) => t.tid === Number(tid));
const findArtifact = (aid) => DATA.artifacts.find((a) => a.aid === Number(aid));

const schoolsOf = (cid) => DATA.schools.filter((s) => s.cid === Number(cid));
const deptsOf = (sid) => DATA.depts.filter((d) => d.sid === Number(sid));
const facultyOf = (did) => DATA.faculty.filter((f) => f.did === Number(did));
const themesOf = (fid) => DATA.themes.filter((t) => t.fid === Number(fid));
const artifactsOf = (tid) => DATA.artifacts.filter((a) => a.tid === Number(tid));
const studentsOf = (aid) => DATA.students.filter((s) => s.aid === Number(aid));

// ------------------------------------------------------------ roles & role-based access
//
// Eight accounts, each scoped to the slice of the College > School > Dept >
// Faculty hierarchy their role is meant to see. There is still no real
// backend - this is a client-side credential check plus a client-side
// scope filter, stored in sessionStorage for the length of the tab's visit.
//   level: 'global'   - every college (Platform Admin, Programme Leader,
//                        Reviewer, Stakeholder)
//   level: 'college'  - only the colleges listed in cids (Institute Admin,
//                        Dean/Principal - both scoped to the KLE campuses)
//   level: 'dept'     - confined to one department and everything under it
//                        (Department Head)
//   level: 'faculty'  - confined to one faculty member's own theme and
//                        everything under it (Faculty Mentor)
const ROLES = [
  { role: 'Platform Administrator', email: 'platform.admin@apnileap.example', password: 'Passw0rd!2026', scope: { level: 'global' } },
  { role: 'Global Programme Leader', email: 'programme.leader@apnileap.example', password: 'Leader@2026!', scope: { level: 'global' } },
  { role: 'Institute Administrator', email: 'institute.admin@kletech.example', password: 'InstAdmin@2026!', scope: { level: 'college', cids: [1, 2] } },
  { role: 'Dean / Principal', email: 'dean@kletech.example', password: 'Dean@2026!', scope: { level: 'college', cids: [1, 2] } },
  { role: 'Department Head', email: 'head.cse@kletech.example', password: 'DeptHead@2026!', scope: { level: 'dept', did: 1 } },
  { role: 'Faculty Mentor', email: 'mentor.hegde@kletech.example', password: 'Mentor@2026!', scope: { level: 'faculty', fid: 1 } },
  { role: 'Reviewer / Success Coach', email: 'reviewer.coach@apnileap.example', password: 'Reviewer@2026!', scope: { level: 'global' } },
  { role: 'Read-only Stakeholder', email: 'stakeholder@apnileap.example', password: 'ReadOnly@2026!', scope: { level: 'global' } },
];

function findRoleByCredentials(email, password) {
  const normalized = email.trim().toLowerCase();
  return ROLES.find((r) => r.email === normalized && r.password === password) || null;
}

const SESSION_KEY = 'apnileap_session';

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch (e) {
    return null;
  }
}

/** Call at the top of every protected page. Bounces to the login page (and returns null) if nobody is signed in. */
function requireSession() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

/** Where a scope lands right after login, and what its "back to my dashboard" link points to. */
function homeUrlFor(scope) {
  if (scope.level === 'dept') return `faculty.html?did=${scope.did}`;
  if (scope.level === 'faculty') return `theme.html?fid=${scope.fid}`;
  return 'portfolio.html';
}

/** Colleges a scope is allowed to see on the portfolio page. */
function collegesInScope(scope) {
  if (scope.level === 'college') return DATA.colleges.filter((c) => scope.cids.includes(c.cid));
  return DATA.colleges;
}

/**
 * Whether a scope may view a page that resolves to this entity chain.
 * Pass whichever ids the current page has resolved so far - every page has
 * a cid by the time it reaches school.html or deeper; did/fid are added
 * once the chain reaches that far down.
 */
function authorize(scope, { cid, did, fid } = {}) {
  if (scope.level === 'global') return true;
  if (scope.level === 'college') return cid !== undefined && scope.cids.includes(cid);
  if (scope.level === 'dept') return did !== undefined && did === scope.did;
  if (scope.level === 'faculty') return fid !== undefined && fid === scope.fid;
  return false;
}

/** Dept/faculty scopes have no portfolio, school or dept list to browse - they're confined to one fixed branch. */
function isBranchScoped(scope) {
  return scope.level === 'dept' || scope.level === 'faculty';
}

/** Replaces the page body with an access-restricted notice plus a link back to the viewer's own dashboard. */
function denyAccess(session) {
  document.querySelector('main').innerHTML = `
    <div class="page-head">
      <h1>Access restricted</h1>
      <p>Your role, ${session.role}, does not have permission to view this page.</p>
    </div>
    <a class="btn--primary" style="display:inline-block;width:auto;text-decoration:none;padding:0 var(--sp-4)" href="${homeUrlFor(session.scope)}">Back to your dashboard</a>
  `;
}

// ------------------------------------------------------------ small helpers shared by every page

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Renders the shared dark topbar with brand + signed-in state + logout.
 * Must land INSIDE .app, as its first child - .app is pinned to exactly
 * 100vh (that's what makes "no scrolling" possible at all), so inserting
 * the topbar as a sibling of .app instead (e.g. on <body>) stacks a full
 * extra 100vh underneath it: topbar height + .app's own 100vh, overflowing
 * every page by exactly the topbar's height. Found by measuring actual
 * rendered heights, not by inspection - the numbers matched exactly.
 */
function renderTopbar(subtitle, session) {
  document.querySelector('.app').insertAdjacentHTML('afterbegin', `
    <header class="topbar">
      <div class="topbar__brand">
        Mini-Project Portfolio Monitoring Portal
        <span>${subtitle}</span>
      </div>
      <div class="topbar__who">
        Signed in as <strong>${session.role}</strong>
        <button type="button" id="logout-btn" class="topbar__logout">Log out</button>
      </div>
    </header>
  `);
  document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
  });
}

/** trail: array of { label, href } — href omitted (or falsy) for the current page. */
function renderBreadcrumbs(container, trail) {
  container.innerHTML = trail.map((step, i) => {
    const sep = i > 0 ? '<span aria-hidden="true">›</span>' : '';
    const inner = step.href ? `<a href="${step.href}">${step.label}</a>` : `<span>${step.label}</span>`;
    return `${sep}${inner}`;
  }).join('');
}

function cardLink(href, title, subtitle) {
  return `
    <a class="card college-card link-card" href="${href}">
      <h2>${title}</h2>
      ${subtitle ? `<div class="campus">${subtitle}</div>` : ''}
    </a>
  `;
}
