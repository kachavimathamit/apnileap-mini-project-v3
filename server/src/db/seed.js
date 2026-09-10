/**
 * Baseline data for a fresh deployment.
 *
 * This is deliberately minimal: the participating institutes and their
 * departments (structural configuration, per section 2.1 of the requirements
 * - "OK to hardcode for phase 1"), and exactly one Platform Administrator
 * account so there is a way to sign in and start building everything else
 * through the application itself.
 *
 * Everything else - mentors, students, projects, reviews, progress - is
 * created for real through the UI: mentors self-register and are approved by
 * a department head, a coordinator allocates projects to guides, and guides
 * and their teams enter project data from there. There is no fake portfolio
 * sitting in the database pretending to be real activity.
 *
 * The official institute names for COEB/COEP and the Sangli institute are
 * still unconfirmed per section 15 of the requirements; the placeholders
 * below are labelled as such.
 */
import { db, migrate, newId } from './connection.js';
import { config } from '../config.js';
import { hashPassword } from '../auth/password.js';

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

const BOOTSTRAP_ADMIN = {
  email: 'platform.admin@apnileap.example',
  name: 'Platform Administrator',
  designation: 'ApniLeap platform operations',
};

async function seed() {
  migrate();

  const existing = db.prepare('SELECT COUNT(*) AS n FROM institutes').get().n;
  if (existing > 0) {
    console.log('Database already contains data. Run `npm run reset` first if you want to reseed.');
    return;
  }

  const passwordHash = await hashPassword(config.seedPassword);
  const instituteIds = {};

  db.transaction(() => {
    for (const institute of INSTITUTES) {
      const id = newId('ins');
      instituteIds[institute.code] = id;
      db.prepare('INSERT INTO institutes (id, code, name, short_name, city) VALUES (?, ?, ?, ?, ?)')
        .run(id, institute.code, institute.name, institute.short, institute.city);
    }

    for (const department of DEPARTMENTS) {
      db.prepare('INSERT INTO departments (id, institute_id, code, name) VALUES (?, ?, ?, ?)')
        .run(newId('dep'), instituteIds[department.institute], department.code, department.name);
    }

    const adminId = newId('usr');
    db.prepare(
      'INSERT INTO users (id, email, password_hash, full_name, designation) VALUES (?, ?, ?, ?, ?)',
    ).run(adminId, BOOTSTRAP_ADMIN.email, passwordHash, BOOTSTRAP_ADMIN.name, BOOTSTRAP_ADMIN.designation);

    db.prepare(
      `INSERT INTO access_grants (id, user_id, role, scope_type, granted_by)
       VALUES (?, ?, 'PLATFORM_ADMIN', 'PLATFORM', ?)`,
    ).run(newId('grt'), adminId, adminId);

    db.prepare(
      `INSERT INTO audit_log (id, actor_user_id, actor_email, action, entity_type, outcome, detail)
       VALUES (?, ?, ?, 'DATABASE_SEEDED', 'system', 'SUCCESS', ?)`,
    ).run(newId('aud'), adminId, BOOTSTRAP_ADMIN.email, JSON.stringify({ institutes: INSTITUTES.length, departments: DEPARTMENTS.length }));
  })();

  console.log('Seed complete - a clean baseline, no demonstration projects or people.\n');
  console.log(`  institutes  : ${INSTITUTES.length}`);
  console.log(`  departments : ${DEPARTMENTS.length}\n`);
  console.log('Sign in as the platform administrator to create everything else:\n');
  console.log(`  ${BOOTSTRAP_ADMIN.email}  (password: ${config.seedPassword})\n`);
  console.log('From there: create institute administrators / department heads as needed, or have Faculty');
  console.log('Mentors self-register at /register - their request will wait for department-head approval.');
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
