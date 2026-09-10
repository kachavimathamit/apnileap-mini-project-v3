import { useState } from 'react';
import { api, type ProjectDetail } from '../api';
import { Alert, ErrorMessage } from './ui';

/**
 * The project record form (requirement 5.5). One component serves both jobs:
 * creating a project inside a department, and editing the definition of an
 * existing one — the fields are identical, so they should not drift apart.
 */

interface Values {
  code: string;
  title: string;
  academicYear: string;
  semester: string;
  startDate: string;
  expectedCompletionDate: string;
  nextReviewDate: string;
  completionPercentage: string;
  needStatement: string;
  problemStatement: string;
  objective: string;
  learningOutcomes: string;
  foundationCourses: string;
  functionalBlocks: string;
  interfaces: string;
  dependencies: string;
  expectedDeliverables: string;
}

const EMPTY: Values = {
  code: '', title: '', academicYear: '', semester: '',
  startDate: '', expectedCompletionDate: '', nextReviewDate: '', completionPercentage: '0',
  needStatement: '', problemStatement: '', objective: '', learningOutcomes: '',
  foundationCourses: '', functionalBlocks: '', interfaces: '', dependencies: '',
  expectedDeliverables: '',
};

/** The nine definition fields from requirement 5.5, with the prompt each one answers. */
const DEFINITION_FIELDS: { key: keyof Values; label: string; hint: string }[] = [
  { key: 'needStatement', label: 'Need statement', hint: 'Whose need does this project serve, and why does it matter?' },
  { key: 'problemStatement', label: 'Problem statement', hint: 'What specifically is unsolved today?' },
  { key: 'objective', label: 'Objective', hint: 'What will exist at the end that does not exist now?' },
  { key: 'learningOutcomes', label: 'Learning outcomes', hint: 'What will the student team be able to do afterwards?' },
  { key: 'foundationCourses', label: 'Foundation courses anchored', hint: 'Which courses does this project put to work?' },
  { key: 'functionalBlocks', label: 'Functional blocks', hint: 'The major parts of the system and what each does.' },
  { key: 'interfaces', label: 'Interfaces', hint: 'How the blocks connect, and to anything outside the project.' },
  { key: 'dependencies', label: 'Dependencies', hint: 'Anything the team needs but does not control — hardware, access, approvals.' },
  { key: 'expectedDeliverables', label: 'Expected deliverables', hint: 'What is handed over at completion.' },
];

function fromProject(project: ProjectDetail['project']): Values {
  return {
    code: project.code,
    title: project.title,
    academicYear: project.academic_year,
    semester: project.semester,
    startDate: project.start_date?.slice(0, 10) ?? '',
    expectedCompletionDate: project.expected_completion_date?.slice(0, 10) ?? '',
    nextReviewDate: project.next_review_date?.slice(0, 10) ?? '',
    completionPercentage: String(project.completion_percentage),
    needStatement: project.need_statement ?? '',
    problemStatement: project.problem_statement ?? '',
    objective: project.objective ?? '',
    learningOutcomes: project.learning_outcomes ?? '',
    foundationCourses: project.foundation_courses ?? '',
    functionalBlocks: project.functional_blocks ?? '',
    interfaces: project.interfaces ?? '',
    dependencies: project.dependencies ?? '',
    expectedDeliverables: project.expected_deliverables ?? '',
  };
}

/** Empty strings are sent as null so a cleared field is actually cleared. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

export function CreateProjectForm({
  departmentId, departmentName, onCreated,
}: { departmentId: string; departmentName: string; onCreated: (message: string) => void }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Values) => (event: { target: { value: string } }) =>
    setValues((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/projects', {
        departmentId,
        code: values.code.trim(),
        title: values.title.trim(),
        academicYear: values.academicYear.trim(),
        semester: values.semester.trim(),
        startDate: values.startDate || undefined,
        expectedCompletionDate: values.expectedCompletionDate || undefined,
        nextReviewDate: values.nextReviewDate || undefined,
        ...Object.fromEntries(
          DEFINITION_FIELDS
            .filter(({ key }) => values[key].trim() !== '')
            .map(({ key }) => [key, values[key].trim()]),
        ),
      });
      setValues(EMPTY);
      onCreated('The project has been created and registered as Green.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Register a new mini-project in {departmentName}</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <Alert kind="info">
          A new project is registered as <strong>Green — On Track</strong> with the reason “Project created”.
          Record milestones, KPIs and the team next; the definition can be edited at any time.
        </Alert>

        <h4>Identity</h4>
        <div className="filters" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="field">
            <label htmlFor="np-code">Project code (required)</label>
            <p className="hint">Must be unique across the programme, e.g. KLE-CSE-2026-05.</p>
            <input id="np-code" type="text" required minLength={2} value={values.code} onChange={set('code')} />
          </div>
          <div className="field">
            <label htmlFor="np-year">Academic year (required)</label>
            <input id="np-year" type="text" required minLength={4} placeholder="2025-26" value={values.academicYear} onChange={set('academicYear')} />
          </div>
          <div className="field">
            <label htmlFor="np-sem">Semester (required)</label>
            <input id="np-sem" type="text" required placeholder="Semester 6" value={values.semester} onChange={set('semester')} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="np-title">Project title (required)</label>
          <input id="np-title" type="text" required minLength={3} value={values.title} onChange={set('title')} />
        </div>

        <div className="filters" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="field">
            <label htmlFor="np-start">Start date</label>
            <input id="np-start" type="date" value={values.startDate} onChange={set('startDate')} />
          </div>
          <div className="field">
            <label htmlFor="np-end">Expected completion</label>
            <input id="np-end" type="date" value={values.expectedCompletionDate} onChange={set('expectedCompletionDate')} />
          </div>
          <div className="field">
            <label htmlFor="np-review">First review date</label>
            <input id="np-review" type="date" value={values.nextReviewDate} onChange={set('nextReviewDate')} />
          </div>
        </div>

        <h4>Definition</h4>
        <p className="card__hint" style={{ marginBottom: 'var(--sp-3)' }}>
          Every field is optional now and can be completed later, but a project without a problem
          statement and objective cannot be reviewed meaningfully.
        </p>
        {DEFINITION_FIELDS.map(({ key, label, hint }) => (
          <div className="field" key={key}>
            <label htmlFor={`np-${key}`}>{label}</label>
            <p className="hint">{hint}</p>
            <textarea id={`np-${key}`} value={values[key]} onChange={set(key)} />
          </div>
        ))}

        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </details>
  );
}

export function EditProjectForm({
  project, onSaved,
}: { project: ProjectDetail['project']; onSaved: (message: string) => void }) {
  const [values, setValues] = useState<Values>(() => fromProject(project));
  const [isArchived, setIsArchived] = useState(Boolean(project.is_archived));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Values) => (event: { target: { value: string } }) =>
    setValues((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/projects/${project.id}`, {
        title: values.title.trim(),
        academicYear: values.academicYear.trim(),
        semester: values.semester.trim(),
        startDate: orNull(values.startDate),
        expectedCompletionDate: orNull(values.expectedCompletionDate),
        nextReviewDate: orNull(values.nextReviewDate),
        completionPercentage: Number(values.completionPercentage),
        isArchived,
        ...Object.fromEntries(DEFINITION_FIELDS.map(({ key }) => [key, values[key].trim()])),
      });
      onSaved(
        isArchived
          ? 'The project has been archived. It is preserved in full but no longer counted in active dashboards.'
          : 'The project record has been updated.',
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Edit the project record</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />

        <h4>Identity and progress</h4>
        <div className="field">
          <label htmlFor="ep-title">Project title</label>
          <input id="ep-title" type="text" required minLength={3} value={values.title} onChange={set('title')} />
        </div>
        <div className="filters" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="field">
            <label htmlFor="ep-year">Academic year</label>
            <input id="ep-year" type="text" required value={values.academicYear} onChange={set('academicYear')} />
          </div>
          <div className="field">
            <label htmlFor="ep-sem">Semester</label>
            <input id="ep-sem" type="text" required value={values.semester} onChange={set('semester')} />
          </div>
          <div className="field">
            <label htmlFor="ep-pct">Completion (%)</label>
            <input
              id="ep-pct" type="number" min={0} max={100}
              value={values.completionPercentage} onChange={set('completionPercentage')}
            />
          </div>
        </div>
        <div className="filters" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="field">
            <label htmlFor="ep-start">Start date</label>
            <input id="ep-start" type="date" value={values.startDate} onChange={set('startDate')} />
          </div>
          <div className="field">
            <label htmlFor="ep-end">Expected completion</label>
            <input id="ep-end" type="date" value={values.expectedCompletionDate} onChange={set('expectedCompletionDate')} />
          </div>
          <div className="field">
            <label htmlFor="ep-review">Next review date</label>
            <input id="ep-review" type="date" value={values.nextReviewDate} onChange={set('nextReviewDate')} />
          </div>
        </div>

        <h4>Definition</h4>
        {DEFINITION_FIELDS.map(({ key, label, hint }) => (
          <div className="field" key={key}>
            <label htmlFor={`ep-${key}`}>{label}</label>
            <p className="hint">{hint}</p>
            <textarea id={`ep-${key}`} value={values[key]} onChange={set(key)} />
          </div>
        ))}

        <p className="card__hint" style={{ marginBottom: 'var(--sp-3)' }}>
          Editing the record does not change the RAG status. Use “Record a status change” on the
          Overview tab for that, so the reason is preserved in the history.
        </p>

        <label className="field field--inline" style={{ marginBottom: 'var(--sp-4)' }}>
          <input type="checkbox" checked={isArchived} onChange={(e) => setIsArchived(e.target.checked)} />
          Archived
        </label>
        <p className="hint" style={{ marginTop: '-0.6rem' }}>
          An archived project keeps every milestone, KPI, challenge, review and status entry it has,
          but drops out of institute and department dashboards. This is the safe alternative to
          deleting a project once it has a real history - reversible at any time by unchecking this
          and saving again.
        </p>

        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save project record'}
        </button>
      </form>
    </details>
  );
}
