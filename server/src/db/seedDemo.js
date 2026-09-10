/**
 * Rich demonstration/test fixture data.
 *
 * This is NOT run against a real deployment - `npm run seed` (seed.js) is the
 * clean baseline used there. This script exists for two purposes: giving the
 * automated test suite deterministic fixtures to assert against, and letting
 * anyone who wants to explore the portal's behaviour see it populated with a
 * realistic-looking portfolio (`npm run seed:demo`). It must never be what a
 * real deployment starts from, which is why it lives under a different name
 * and is never invoked by the application itself.
 */
import { db, migrate, newId } from './connection.js';
import { config } from '../config.js';
import { hashPassword } from '../auth/password.js';

const PASSWORD = config.seedPassword;

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function daysAgoStamp(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

const INSTITUTES = [
  { code: 'KLE', short: 'KLE Tech', name: 'KLE Technological University', city: 'Hubballi' },
  { code: 'MMCOE', short: 'MMCOE', name: 'Marathwada Mitra Mandal College of Engineering', city: 'Pune' },
  { code: 'RIT', short: 'RIT', name: 'Rajarambapu Institute of Technology', city: 'Islampur' },
  { code: 'COEP', short: 'COEP', name: 'College of Engineering Pune (COEB/COEP - name to be confirmed)', city: 'Pune' },
  { code: 'SANGLI', short: 'Sangli', name: 'Sangli Institute (official name to be confirmed)', city: 'Sangli' },
];

const DEPARTMENTS = [
  { institute: 'KLE', code: 'CSE', name: 'Computer Science and Engineering' },
  { institute: 'KLE', code: 'ECE', name: 'Electronics and Communication Engineering' },
  { institute: 'KLE', code: 'MECH', name: 'Mechanical Engineering' },
  { institute: 'MMCOE', code: 'CSE', name: 'Computer Engineering' },
  { institute: 'MMCOE', code: 'ENTC', name: 'Electronics and Telecommunication' },
  { institute: 'RIT', code: 'CSE', name: 'Computer Science and Engineering' },
  { institute: 'RIT', code: 'EEE', name: 'Electrical Engineering' },
  { institute: 'COEP', code: 'CSE', name: 'Computer Engineering' },
  { institute: 'SANGLI', code: 'CSE', name: 'Computer Science and Engineering' },
];

const USERS = [
  {
    key: 'admin', email: 'platform.admin@apnileap.example', name: 'Platform Administrator',
    designation: 'ApniLeap platform operations',
    grants: [{ role: 'PLATFORM_ADMIN', scope: 'PLATFORM' }],
  },
  {
    key: 'balaji', email: 'balaji@apnileap.example', name: 'Balaji',
    designation: 'Global Programme Leader, ApniLeap',
    grants: INSTITUTES.map((i) => ({ role: 'GLOBAL_PROGRAMME_LEADER', scope: 'INSTITUTE', institute: i.code })),
  },
  {
    key: 'narayan', email: 'narayan@kletech.example', name: 'Narayan',
    designation: 'Programme lead, KLE Technological University',
    grants: [{ role: 'DEAN', scope: 'INSTITUTE', institute: 'KLE' }],
  },
  {
    key: 'kle_admin', email: 'admin.kle@kletech.example', name: 'Shruti Kulkarni',
    designation: 'Institute Administrator, KLE',
    grants: [{ role: 'INSTITUTE_ADMIN', scope: 'INSTITUTE', institute: 'KLE' }],
  },
  {
    key: 'kle_cse_head', email: 'head.cse@kletech.example', name: 'Dr. Anita Deshpande',
    designation: 'Head, Computer Science and Engineering',
    grants: [{ role: 'DEPARTMENT_HEAD', scope: 'DEPARTMENT', institute: 'KLE', department: 'CSE' }],
  },
  {
    key: 'kle_ece_head', email: 'head.ece@kletech.example', name: 'Dr. Rajesh Patil',
    designation: 'Head, Electronics and Communication',
    grants: [{ role: 'DEPARTMENT_HEAD', scope: 'DEPARTMENT', institute: 'KLE', department: 'ECE' }],
  },
  {
    key: 'kle_mentor1', email: 'mentor.hegde@kletech.example', name: 'Prof. Sanjay Hegde',
    designation: 'Faculty Mentor, CSE',
    grants: [{ role: 'FACULTY_MENTOR', scope: 'DEPARTMENT', institute: 'KLE', department: 'CSE' }],
  },
  {
    key: 'kle_mentor2', email: 'mentor.nayak@kletech.example', name: 'Prof. Meera Nayak',
    designation: 'Faculty Mentor, ECE',
    grants: [{ role: 'FACULTY_MENTOR', scope: 'DEPARTMENT', institute: 'KLE', department: 'ECE' }],
  },
  {
    key: 'kle_student', email: 'student.team4@kletech.example', name: 'Team CSE-04 (student representative)',
    designation: 'Student team member',
    grants: [{ role: 'STUDENT', scope: 'PROJECT', institute: 'KLE', projectCode: 'KLE-CSE-2026-04' }],
  },
  {
    key: 'coach', email: 'coach@apnileap.example', name: 'Priya Raman',
    designation: 'Success Coach, ApniLeap',
    grants: [
      { role: 'REVIEWER', scope: 'INSTITUTE', institute: 'KLE' },
      { role: 'REVIEWER', scope: 'INSTITUTE', institute: 'RIT' },
    ],
  },
  {
    key: 'mmcoe_admin', email: 'admin.mmcoe@mmcoe.example', name: 'Vikram Joshi',
    designation: 'Institute Administrator, MMCOE',
    grants: [{ role: 'INSTITUTE_ADMIN', scope: 'INSTITUTE', institute: 'MMCOE' }],
  },
  {
    key: 'mmcoe_mentor', email: 'mentor.kale@mmcoe.example', name: 'Prof. Sneha Kale',
    designation: 'Faculty Mentor, Computer Engineering',
    grants: [{ role: 'FACULTY_MENTOR', scope: 'DEPARTMENT', institute: 'MMCOE', department: 'CSE' }],
  },
  {
    key: 'rit_admin', email: 'admin.rit@rit.example', name: 'Amol Shinde',
    designation: 'Institute Administrator, RIT',
    grants: [{ role: 'INSTITUTE_ADMIN', scope: 'INSTITUTE', institute: 'RIT' }],
  },
  {
    key: 'rit_mentor', email: 'mentor.pawar@rit.example', name: 'Prof. Kiran Pawar',
    designation: 'Faculty Mentor, CSE',
    grants: [{ role: 'FACULTY_MENTOR', scope: 'DEPARTMENT', institute: 'RIT', department: 'CSE' }],
  },
  {
    key: 'coep_mentor', email: 'mentor.iyer@coep.example', name: 'Prof. Latha Iyer',
    designation: 'Faculty Mentor, Computer Engineering',
    grants: [{ role: 'FACULTY_MENTOR', scope: 'DEPARTMENT', institute: 'COEP', department: 'CSE' }],
  },
  {
    key: 'observer', email: 'trustee@apnileap.example', name: 'K. Ramesh',
    designation: 'Trustee (read-only)',
    grants: [{ role: 'READ_ONLY', scope: 'INSTITUTE', institute: 'MMCOE' }],
  },
];

const PROJECTS = [
  {
    code: 'KLE-CSE-2026-01', institute: 'KLE', department: 'CSE',
    title: 'Campus energy monitoring dashboard',
    status: 'GREEN', completion: 72, mentor: 'kle_mentor1', statusAgeDays: 40, updatedDaysAgo: 2,
    needStatement: 'The campus has no consolidated view of block-level electricity consumption.',
    problemStatement: 'Meter readings are collected manually each week and are not comparable across blocks.',
    objective: 'Deliver a working dashboard that ingests meter data and shows per-block consumption trends.',
    learningOutcomes: 'Data acquisition, time-series storage, dashboard design, basic statistics.',
    foundationCourses: 'Database Systems; Web Technologies; Sensors and Instrumentation.',
    functionalBlocks: 'Meter interface; ingestion service; time-series store; web dashboard.',
    interfaces: 'Modbus meter reader; REST ingestion API; browser dashboard.',
    dependencies: 'Access to three campus meters; institute network VLAN clearance.',
    expectedDeliverables: 'Working dashboard, ingestion service, calibration report, user guide.',
    nextReview: daysFromNow(9),
    milestones: [
      { title: 'Requirement study and meter survey', planned: daysFromNow(-60), actual: daysFromNow(-58), status: 'COMPLETED' },
      { title: 'Ingestion service prototype', planned: daysFromNow(-30), actual: daysFromNow(-31), status: 'COMPLETED', critical: true },
      { title: 'Dashboard v1 with two blocks', planned: daysFromNow(5), status: 'CURRENT', critical: true },
      { title: 'Calibration and handover', planned: daysFromNow(35), status: 'UPCOMING' },
    ],
    kpis: [
      { name: 'Meters integrated', target: '3', unit: 'meters', value: '3', meets: true },
      { name: 'Dashboard load time', target: '< 3', unit: 'seconds', value: '1.8', meets: true },
    ],
    reviews: [
      { decision: 'APPROVED', comments: 'Ingestion service is stable and the team demonstrated live readings from two meters.', daysAgo: 12 },
    ],
  },
  {
    code: 'KLE-CSE-2026-04', institute: 'KLE', department: 'CSE',
    title: 'Assistive braille reader for lab instruments',
    status: 'RED', completion: 34, mentor: 'kle_mentor1', statusAgeDays: 11, updatedDaysAgo: 3,
    needStatement: 'Visually impaired students cannot read digital lab instrument displays independently.',
    problemStatement: 'No affordable device converts instrument readouts into refreshable braille in real time.',
    objective: 'Build a low-cost braille cell module that reads instrument output over serial and renders it.',
    learningOutcomes: 'Embedded firmware, actuator control, accessibility design, user testing.',
    foundationCourses: 'Microcontrollers; Embedded C; Human-Computer Interaction.',
    functionalBlocks: 'Serial capture; text translation; solenoid driver; braille cell array.',
    interfaces: 'RS-232 instrument port; SPI driver bus.',
    dependencies: 'Piezo braille actuators (imported); accessibility lab access.',
    expectedDeliverables: 'Working 8-cell prototype, firmware source, user trial report.',
    nextReview: daysFromNow(3),
    milestones: [
      { title: 'Literature and accessibility study', planned: daysFromNow(-70), actual: daysFromNow(-68), status: 'COMPLETED' },
      { title: 'Actuator procurement', planned: daysFromNow(-35), status: 'MISSED', critical: true },
      { title: 'Firmware for 4-cell prototype', planned: daysFromNow(-10), status: 'MISSED', critical: true },
      { title: 'User trial with accessibility centre', planned: daysFromNow(25), status: 'UPCOMING' },
    ],
    kpis: [
      { name: 'Braille cells functioning', target: '8', unit: 'cells', value: '0', meets: false },
      { name: 'Refresh latency', target: '< 500', unit: 'ms', value: 'not measured', meets: false },
    ],
    issues: [
      {
        title: 'Piezo braille actuators not delivered',
        description: 'The imported piezo actuator order placed in the previous term has not cleared customs. No hardware is available for the prototype.',
        rootCause: 'Single overseas supplier; import documentation was raised late and no alternate vendor was identified.',
        impact: 'Two critical milestones missed. The prototype cannot be built and the accessibility user trial cannot be scheduled.',
        assistance: 'Institute purchase office support to clear customs, or approval to source a domestic alternative within two weeks.',
        supportSource: 'INSTITUTE', severity: 'CRITICAL', escalation: 'INSTITUTE', raisedBy: 'kle_mentor1',
        evidence: 'Purchase order KLE/PO/2026/1187 and courier tracking showing customs hold since day 24.',
        actions: [
          { description: 'Follow up with the purchase office daily and obtain a written customs status by Friday.', owner: 'kle_mentor1', dueInDays: -4 },
          { description: 'Identify and price two domestic actuator suppliers as a fallback.', owner: 'kle_cse_head', dueInDays: 5 },
        ],
      },
      {
        title: 'Team unable to test firmware without hardware',
        description: 'The student team has written the SPI driver but cannot validate timing without the actuator array.',
        rootCause: 'Dependency on the blocked hardware procurement.',
        impact: 'Firmware quality is unverified; rework risk is high once hardware arrives.',
        assistance: 'Loan of a similar actuator array from the ECE department for bench testing.',
        supportSource: 'DEPARTMENT', severity: 'HIGH', escalation: 'DEPARTMENT', raisedBy: 'kle_student',
        evidence: 'Firmware repository commits show driver complete; no test log exists.',
        actions: [
          { description: 'Request a loan actuator array from the ECE lab and set up a bench harness.', owner: 'kle_mentor1', dueInDays: 3 },
        ],
      },
    ],
    reviews: [
      { decision: 'ESCALATED', comments: 'Procurement block is outside the team control. Escalating to institute level and setting a weekly review cadence until hardware is available.', recommended: 'RED', daysAgo: 11 },
      { decision: 'EVIDENCE_REQUESTED', comments: 'Please attach the customs status letter and the domestic supplier quotes before the next review.', daysAgo: 4 },
    ],
    history: [
      { from: 'GREEN', to: 'YELLOW', daysAgo: 30, rationale: 'Actuator delivery slipped past the planned procurement date.' },
      { from: 'YELLOW', to: 'RED', daysAgo: 11, rationale: 'Second critical milestone missed with no viable path until hardware clears customs.' },
    ],
  },
  {
    code: 'KLE-ECE-2026-02', institute: 'KLE', department: 'ECE',
    title: 'Low-cost air quality sensing node',
    status: 'YELLOW', completion: 55, mentor: 'kle_mentor2', statusAgeDays: 8, updatedDaysAgo: 5,
    needStatement: 'Air quality data for the Hubballi campus corridor is unavailable at street level.',
    problemStatement: 'Commercial monitoring stations are too costly to deploy at the required density.',
    objective: 'Design a calibrated PM2.5 and NO2 sensing node under a defined unit cost.',
    learningOutcomes: 'Analog front-end design, sensor calibration, LoRa communication, field deployment.',
    foundationCourses: 'Analog Electronics; Communication Systems; Signals and Systems.',
    functionalBlocks: 'Sensor board; MCU; LoRa radio; solar power stage.',
    interfaces: 'LoRaWAN gateway; calibration reference station.',
    dependencies: 'Reference-grade station access for calibration.',
    expectedDeliverables: 'Two calibrated nodes, calibration curve, deployment report.',
    nextReview: daysFromNow(6),
    milestones: [
      { title: 'Sensor selection and cost model', planned: daysFromNow(-55), actual: daysFromNow(-55), status: 'COMPLETED' },
      { title: 'Prototype board bring-up', planned: daysFromNow(-20), actual: daysFromNow(-14), status: 'COMPLETED', critical: true },
      { title: 'Calibration against reference station', planned: daysFromNow(-2), status: 'CURRENT', critical: true },
      { title: 'Field deployment', planned: daysFromNow(30), status: 'UPCOMING' },
    ],
    kpis: [
      { name: 'Unit cost', target: '< 4500', unit: 'INR', value: '4380', meets: true },
      { name: 'PM2.5 correlation with reference', target: '> 0.9', unit: 'r', value: '0.71', meets: false },
    ],
    issues: [
      {
        title: 'Calibration correlation below target',
        description: 'PM2.5 readings correlate at r=0.71 against the reference station, below the 0.9 target.',
        rootCause: 'Humidity compensation is not applied in the current firmware.',
        impact: 'Deployment cannot proceed until the calibration curve is acceptable.',
        assistance: 'Guidance on humidity compensation models from the environmental engineering group.',
        supportSource: 'DEPARTMENT', severity: 'MEDIUM', escalation: 'DEPARTMENT', raisedBy: 'kle_mentor2',
        actions: [
          { description: 'Implement humidity compensation and re-run a seven-day calibration.', owner: 'kle_mentor2', dueInDays: 10 },
        ],
      },
    ],
    reviews: [
      { decision: 'CHANGES_REQUESTED', comments: 'Cost target met. Calibration must reach the stated correlation before field deployment is approved.', recommended: 'YELLOW', daysAgo: 8 },
    ],
    history: [{ from: 'GREEN', to: 'YELLOW', daysAgo: 8, rationale: 'KPI for calibration correlation is below target and the milestone date has passed.' }],
  },
  {
    code: 'KLE-MECH-2026-01', institute: 'KLE', department: 'MECH', title: 'Retrofit kit for manual wheelchair power assist',
    status: 'GREEN', completion: 48, mentor: 'kle_mentor1', statusAgeDays: 60, updatedDaysAgo: 20,
    objective: 'Design a bolt-on power assist retrofit for standard manual wheelchairs.',
    problemStatement: 'Powered wheelchairs are unaffordable; retrofit kits are not available locally.',
    nextReview: daysFromNow(14),
    milestones: [{ title: 'Concept design review', planned: daysFromNow(-40), actual: daysFromNow(-40), status: 'COMPLETED' }],
    kpis: [{ name: 'Kit weight', target: '< 6', unit: 'kg', value: '5.4', meets: true }],
  },
  {
    code: 'MMCOE-CSE-2026-01', institute: 'MMCOE', department: 'CSE', title: 'Attendance analytics for laboratory sessions',
    status: 'GREEN', completion: 66, mentor: 'mmcoe_mentor', statusAgeDays: 25, updatedDaysAgo: 4,
    objective: 'Provide lab coordinators with per-session participation analytics.',
    problemStatement: 'Lab participation is recorded on paper and never analysed.',
    nextReview: daysFromNow(11),
    milestones: [
      { title: 'Data model and consent design', planned: daysFromNow(-45), actual: daysFromNow(-45), status: 'COMPLETED' },
      { title: 'Analytics view', planned: daysFromNow(12), status: 'CURRENT' },
    ],
    kpis: [{ name: 'Sessions analysed', target: '40', unit: 'sessions', value: '31', meets: false }],
  },
  {
    code: 'MMCOE-ENTC-2026-02', institute: 'MMCOE', department: 'ENTC', title: 'Fault detection for campus solar inverters',
    status: 'RED', completion: 22, mentor: 'mmcoe_mentor', statusAgeDays: 26, updatedDaysAgo: 21,
    objective: 'Detect and classify inverter faults from telemetry within one hour of occurrence.',
    problemStatement: 'Inverter faults are noticed only during monthly maintenance rounds.',
    nextReview: daysFromNow(-2),
    milestones: [
      { title: 'Telemetry access agreement', planned: daysFromNow(-50), status: 'MISSED', critical: true },
      { title: 'Baseline fault classifier', planned: daysFromNow(-15), status: 'MISSED', critical: true },
    ],
    kpis: [{ name: 'Detection latency', target: '< 60', unit: 'minutes', value: 'not measured', meets: false }],
    issues: [
      {
        title: 'No access to inverter telemetry',
        description: 'The facilities vendor has not granted read access to the inverter monitoring portal.',
        rootCause: 'No data-sharing agreement exists between the institute and the facilities vendor.',
        impact: 'The project has no data. Both critical milestones are missed and no classifier can be trained.',
        assistance: 'Institute-level agreement with the facilities vendor, or an industry partner willing to share anonymised telemetry.',
        supportSource: 'INDUSTRY_PARTNER', severity: 'CRITICAL', escalation: 'PROGRAMME', raisedBy: 'mmcoe_mentor',
        evidence: 'Email thread with the facilities vendor showing three unanswered access requests.',
        actions: [{ description: 'Draft a data-sharing request for institute sign-off and route it to the vendor.', owner: 'mmcoe_admin', dueInDays: -6 }],
      },
    ],
    reviews: [{ decision: 'ESCALATED', comments: 'Escalating to the programme level. Without telemetry access the project scope must be changed.', recommended: 'RED', daysAgo: 20 }],
    history: [{ from: 'GREEN', to: 'RED', daysAgo: 26, rationale: 'Two critical milestones missed with no data access and no viable alternative path.' }],
  },
  {
    code: 'RIT-CSE-2026-01', institute: 'RIT', department: 'CSE', title: 'Regional language voice interface for farm advisories',
    status: 'YELLOW', completion: 58, mentor: 'rit_mentor', statusAgeDays: 14, updatedDaysAgo: 6,
    objective: 'Deliver spoken crop advisories in Marathi over a basic phone interface.',
    problemStatement: 'Text-based advisories are inaccessible to farmers with low literacy.',
    nextReview: daysFromNow(4),
    milestones: [
      { title: 'Speech corpus collection', planned: daysFromNow(-40), actual: daysFromNow(-36), status: 'COMPLETED' },
      { title: 'Intent recognition above 80 percent', planned: daysFromNow(-5), status: 'CURRENT', critical: true },
    ],
    kpis: [{ name: 'Intent recognition accuracy', target: '> 80', unit: '%', value: '68', meets: false }],
    issues: [
      {
        title: 'Recognition accuracy short of target',
        description: 'Intent recognition reaches 68 percent against an 80 percent target, mainly on dialect variation.',
        rootCause: 'Training corpus covers one district only.',
        impact: 'Field trial cannot start; the milestone is at risk.',
        assistance: 'Support to collect 200 additional samples from two more districts.',
        supportSource: 'APNILEAP', severity: 'HIGH', escalation: 'DEPARTMENT', raisedBy: 'rit_mentor',
        actions: [{ description: 'Collect and label 200 additional dialect samples.', owner: 'rit_mentor', dueInDays: 12 }],
      },
    ],
    reviews: [{ decision: 'CHANGES_REQUESTED', comments: 'Corpus breadth is the limiting factor. Approve the additional collection effort and re-review in two weeks.', recommended: 'YELLOW', daysAgo: 14 }],
    history: [{ from: 'GREEN', to: 'YELLOW', daysAgo: 14, rationale: 'Accuracy KPI below target and the critical milestone date has arrived.' }],
  },
  {
    code: 'RIT-EEE-2026-01', institute: 'RIT', department: 'EEE', title: 'Islanding detection for rooftop solar',
    status: 'GREEN', completion: 40, mentor: 'rit_mentor', statusAgeDays: 35, updatedDaysAgo: 30,
    objective: 'Implement and test a passive islanding detection scheme on a lab microgrid.',
    problemStatement: 'Existing detection schemes have a large non-detection zone.',
    nextReview: daysFromNow(20),
    milestones: [{ title: 'Simulation of detection scheme', planned: daysFromNow(-25), actual: daysFromNow(-25), status: 'COMPLETED' }],
    kpis: [{ name: 'Non-detection zone', target: '< 5', unit: '%', value: '6.2', meets: false }],
  },
  {
    code: 'COEP-CSE-2026-01', institute: 'COEP', department: 'CSE', title: 'Digital twin of a campus water distribution loop',
    status: 'GREEN', completion: 61, mentor: 'coep_mentor', statusAgeDays: 45, updatedDaysAgo: 3,
    objective: 'Model the campus water loop and predict pressure loss under demand scenarios.',
    problemStatement: 'Pressure complaints cannot be traced to a cause without a hydraulic model.',
    nextReview: daysFromNow(16),
    milestones: [
      { title: 'Network survey and model build', planned: daysFromNow(-35), actual: daysFromNow(-33), status: 'COMPLETED' },
      { title: 'Validation against field readings', planned: daysFromNow(10), status: 'CURRENT' },
    ],
    kpis: [{ name: 'Model pressure error', target: '< 8', unit: '%', value: '6.5', meets: true }],
  },
  {
    code: 'SANGLI-CSE-2026-01', institute: 'SANGLI', department: 'CSE', title: 'Offline-first health record capture for rural camps',
    status: 'YELLOW', completion: 30, mentor: 'coep_mentor', statusAgeDays: 18, updatedDaysAgo: 16,
    objective: 'Capture health camp records offline and synchronise them when connectivity returns.',
    problemStatement: 'Camp records are captured on paper and lost or duplicated during transcription.',
    nextReview: daysFromNow(7),
    milestones: [
      { title: 'Offline data store design', planned: daysFromNow(-30), actual: daysFromNow(-28), status: 'COMPLETED' },
      { title: 'Conflict-free sync', planned: daysFromNow(-3), status: 'CURRENT', critical: true },
    ],
    kpis: [{ name: 'Sync conflicts per 100 records', target: '0', unit: 'conflicts', value: '4', meets: false }],
    history: [{ from: 'GREEN', to: 'YELLOW', daysAgo: 18, rationale: 'Sync conflicts above target and the mentor requested design guidance.' }],
  },
];

async function seedDemo() {
  migrate();

  const existing = db.prepare('SELECT COUNT(*) AS n FROM institutes').get().n;
  if (existing > 0) {
    console.log('Database already contains data. Run `npm run reset` first if you want to reseed.');
    return;
  }

  const passwordHash = await hashPassword(PASSWORD);
  const instituteIds = {};
  const departmentIds = {};
  const userIds = {};
  const projectIds = {};

  db.transaction(() => {
    for (const institute of INSTITUTES) {
      const id = newId('ins');
      instituteIds[institute.code] = id;
      db.prepare('INSERT INTO institutes (id, code, name, short_name, city) VALUES (?, ?, ?, ?, ?)')
        .run(id, institute.code, institute.name, institute.short, institute.city);
    }

    for (const department of DEPARTMENTS) {
      const id = newId('dep');
      departmentIds[`${department.institute}:${department.code}`] = id;
      db.prepare('INSERT INTO departments (id, institute_id, code, name) VALUES (?, ?, ?, ?)')
        .run(id, instituteIds[department.institute], department.code, department.name);
    }

    for (const user of USERS) {
      const id = newId('usr');
      userIds[user.key] = id;
      db.prepare(
        'INSERT INTO users (id, email, password_hash, full_name, designation) VALUES (?, ?, ?, ?, ?)',
      ).run(id, user.email, passwordHash, user.name, user.designation);
    }

    db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?')
      .run(userIds.kle_cse_head, departmentIds['KLE:CSE']);
    db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?')
      .run(userIds.kle_ece_head, departmentIds['KLE:ECE']);
    db.prepare('UPDATE departments SET coordinator_user_id = ? WHERE id = ?')
      .run(userIds.kle_mentor1, departmentIds['KLE:CSE']);

    for (const project of PROJECTS) {
      const id = newId('prj');
      projectIds[project.code] = id;
      db.prepare(
        `INSERT INTO projects
           (id, code, institute_id, department_id, title, academic_year, semester,
            start_date, expected_completion_date, next_review_date,
            need_statement, problem_statement, objective, learning_outcomes, foundation_courses,
            functional_blocks, interfaces, dependencies, expected_deliverables,
            rag_status, rag_status_since, completion_percentage, last_update_at, created_at, created_by)
         VALUES (@id, @code, @institute_id, @department_id, @title, '2025-26', 'Semester 6',
                 @start_date, @expected_completion_date, @next_review_date,
                 @need_statement, @problem_statement, @objective, @learning_outcomes, @foundation_courses,
                 @functional_blocks, @interfaces, @dependencies, @expected_deliverables,
                 @rag_status, @rag_status_since, @completion_percentage, @last_update_at, @created_at, @created_by)`,
      ).run({
        id,
        code: project.code,
        institute_id: instituteIds[project.institute],
        department_id: departmentIds[`${project.institute}:${project.department}`],
        title: project.title,
        start_date: daysFromNow(-90),
        expected_completion_date: daysFromNow(60),
        next_review_date: project.nextReview ?? null,
        need_statement: project.needStatement ?? null,
        problem_statement: project.problemStatement ?? null,
        objective: project.objective ?? null,
        learning_outcomes: project.learningOutcomes ?? null,
        foundation_courses: project.foundationCourses ?? null,
        functional_blocks: project.functionalBlocks ?? null,
        interfaces: project.interfaces ?? null,
        dependencies: project.dependencies ?? null,
        expected_deliverables: project.expectedDeliverables ?? null,
        rag_status: project.status,
        rag_status_since: daysAgoStamp(project.statusAgeDays ?? 30),
        completion_percentage: project.completion,
        last_update_at: daysAgoStamp(project.updatedDaysAgo ?? 5),
        created_at: daysAgoStamp(90),
        created_by: userIds.admin,
      });
    }

    for (const user of USERS) {
      for (const grant of user.grants) {
        db.prepare(
          `INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, department_id, project_id, granted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId('grt'),
          userIds[user.key],
          grant.role,
          grant.scope,
          grant.institute ? instituteIds[grant.institute] : null,
          grant.department ? departmentIds[`${grant.institute}:${grant.department}`] : null,
          grant.projectCode ? projectIds[grant.projectCode] : null,
          userIds.admin,
        );
      }
    }

    for (const project of PROJECTS) {
      const projectId = projectIds[project.code];
      const instituteId = instituteIds[project.institute];

      db.prepare(
        `INSERT INTO project_members (id, project_id, institute_id, user_id, member_role, display_name)
         VALUES (?, ?, ?, ?, 'FACULTY_MENTOR', NULL)`,
      ).run(newId('mem'), projectId, instituteId, userIds[project.mentor]);

      db.prepare(
        `INSERT INTO project_members (id, project_id, institute_id, user_id, member_role, team_identifier, display_name)
         VALUES (?, ?, ?, NULL, 'STUDENT', ?, NULL)`,
      ).run(newId('mem'), projectId, instituteId, `${project.code}-TEAM`);

      if (project.code === 'KLE-CSE-2026-04') {
        db.prepare(
          `INSERT INTO project_members (id, project_id, institute_id, user_id, member_role, team_identifier)
           VALUES (?, ?, ?, ?, 'STUDENT', ?)`,
        ).run(newId('mem'), projectId, instituteId, userIds.kle_student, `${project.code}-TEAM`);
      }

      (project.milestones ?? []).forEach((milestone, index) => {
        db.prepare(
          `INSERT INTO milestones (id, project_id, institute_id, sequence, title, planned_date, actual_date, status, is_critical)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId('mst'), projectId, instituteId, index, milestone.title,
              milestone.planned ?? null, milestone.actual ?? null, milestone.status,
              milestone.critical ? 1 : 0);
      });

      for (const kpi of project.kpis ?? []) {
        const kpiId = newId('kpi');
        db.prepare(
          `INSERT INTO kpis (id, project_id, institute_id, name, target_value, unit, accountable_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(kpiId, projectId, instituteId, kpi.name, kpi.target, kpi.unit, userIds[project.mentor]);

        db.prepare(
          `INSERT INTO kpi_measurements
             (id, kpi_id, project_id, institute_id, measured_value, measurement_date, evidence, meets_target, recorded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId('kpm'), kpiId, projectId, instituteId, kpi.value, daysFromNow(-7),
              'Measured during the most recent review session.', kpi.meets ? 1 : 0, userIds[project.mentor]);
      }

      for (const issue of project.issues ?? []) {
        const issueId = newId('iss');
        db.prepare(
          `INSERT INTO issues
             (id, project_id, institute_id, title, description, root_cause, impact, assistance_required,
              support_source, severity, escalation_level, evidence, raised_by, raised_by_role, opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(issueId, projectId, instituteId, issue.title, issue.description,
              issue.rootCause ?? null, issue.impact ?? null, issue.assistance ?? null,
              issue.supportSource ?? null, issue.severity, issue.escalation,
              issue.evidence ?? null, userIds[issue.raisedBy], 'FACULTY_MENTOR',
              daysAgoStamp(project.statusAgeDays ?? 20));

        for (const action of issue.actions ?? []) {
          db.prepare(
            `INSERT INTO corrective_actions
               (id, project_id, institute_id, issue_id, description, owner_user_id, due_date,
                escalation_owner_user_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(newId('act'), projectId, instituteId, issueId, action.description,
                userIds[action.owner], daysFromNow(action.dueInDays),
                project.institute === 'KLE' ? userIds.kle_cse_head : null,
                userIds[project.mentor]);
        }
      }

      const latestReview = (project.reviews ?? []).reduce(
        (newest, review) => (newest === null || review.daysAgo < newest.daysAgo ? review : newest),
        null,
      );
      if (latestReview) {
        db.prepare('UPDATE projects SET last_review_at = ? WHERE id = ?')
          .run(daysAgoStamp(latestReview.daysAgo), projectId);
      }

      for (const review of project.reviews ?? []) {
        db.prepare(
          `INSERT INTO reviews
             (id, project_id, institute_id, reviewer_user_id, reviewer_name, review_date,
              previous_status, recommended_status, decision, comments)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId('rev'), projectId, instituteId, userIds.coach, 'Priya Raman',
              daysAgoStamp(review.daysAgo), project.status, review.recommended ?? null,
              review.decision, review.comments);
      }

      db.prepare(
        `INSERT INTO status_history
           (id, project_id, institute_id, previous_status, new_status, changed_by, changed_by_name, changed_at, rationale)
         VALUES (?, ?, ?, NULL, 'GREEN', ?, ?, ?, 'Project registered in the portal.')`,
      ).run(newId('sth'), projectId, instituteId, userIds.admin, 'Platform Administrator', daysAgoStamp(90));

      for (const entry of project.history ?? []) {
        db.prepare(
          `INSERT INTO status_history
             (id, project_id, institute_id, previous_status, new_status, changed_by, changed_by_name, changed_at, rationale)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(newId('sth'), projectId, instituteId, entry.from, entry.to,
              userIds[project.mentor], USERS.find((u) => u.key === project.mentor).name,
              daysAgoStamp(entry.daysAgo), entry.rationale);
      }

      db.prepare(
        `INSERT INTO repository_links (id, project_id, institute_id, provider, label, repo_url, visibility, added_by)
         VALUES (?, ?, ?, 'GITHUB', 'Project source repository', ?, 'PRIVATE', ?)`,
      ).run(newId('rep'), projectId, instituteId,
            `https://github.com/apnileap-private/${project.code.toLowerCase()}`, userIds[project.mentor]);
    }

    db.prepare(
      `INSERT INTO audit_log (id, actor_user_id, actor_email, action, entity_type, outcome, detail)
       VALUES (?, ?, ?, 'DATABASE_SEEDED', 'system', 'SUCCESS', ?)`,
    ).run(newId('aud'), userIds.admin, 'platform.admin@apnileap.example',
          JSON.stringify({ institutes: INSTITUTES.length, projects: PROJECTS.length }));
  })();

  console.log('Demo seed complete (fixture/test data - not for a real deployment).\n');
  console.log(`  institutes : ${INSTITUTES.length}`);
  console.log(`  departments: ${DEPARTMENTS.length}`);
  console.log(`  users      : ${USERS.length}`);
  console.log(`  projects   : ${PROJECTS.length}\n`);
  console.log(`All demo accounts use the password: ${PASSWORD}\n`);
  for (const user of USERS) {
    console.log(`  ${user.email.padEnd(38)} ${user.designation}`);
  }
}

seedDemo().catch((error) => {
  console.error('Demo seed failed:', error);
  process.exit(1);
});
