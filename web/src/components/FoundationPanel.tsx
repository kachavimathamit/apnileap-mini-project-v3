import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Card, ErrorMessage, Alert } from './ui';

/**
 * Foundation Integration extension (docs/DATABASE-DESIGN.txt Section 9):
 * theme selection, engine decomposition against the handbook's Engine
 * Definition & Readiness Template, the formal Gate 0-4 ladder with
 * per-student rubric marking, the three sprints, the COE-aligned calendar,
 * and the guide's informal weekly check-in. Everything here stays locked
 * (server-enforced, this UI just reflects it) until a guide is allocated.
 */

interface Theme {
  id: string; code: string; title: string; academic_subtitle: string | null;
  foundational_courses: string[]; core_concepts: { course: string; concepts: string }[];
  minimum_evidence: string[]; final_artefact_description: string | null;
  institute_id: string | null; owner_faculty_name: string | null;
}

interface Engine {
  id: string; code: string; name: string; primary_course: string | null; responsibility: string;
  inputs: string | null; outputs: string | null; internal_state: string | null;
  algorithm_mechanism: string | null; interface_spec: string | null; dependencies_note: string | null;
  kpi_target: string | null; failure_case: string | null; validation_method: string | null;
  status: 'PROPOSED' | 'APPROVED' | 'IN_PROGRESS' | 'VALIDATED';
  owner_display_name: string | null; owner_team_identifier: string | null;
  approved_by_name: string | null;
}

interface EngineDependency { id: string; engine_id: string; depends_on_engine_id: string; note: string | null }

interface StudentMember { id: string; name: string | null; team_identifier: string | null }

interface RubricCriterion {
  id: string; criterion_name: string; weight_marks: number;
  level_descriptors: Record<string, string> | null;
}

interface Gate {
  id: string; sequence: number; name: string; marks_weight: number;
  stage_range: string; primary_review_focus: string; course_outcomes: string[];
  criteria: RubricCriterion[];
  unlocked: boolean;
  latestAttempt: {
    attempt_number: number; decision: 'PASS' | 'RESUBMIT'; max_marks: number;
    reviewer_name: string; comments: string; next_gate_unlocked: number;
  } | null;
}

interface Sprint { id: string; name: string; stage_range: string; objective: string; purpose: string | null; closes_gate_id: string | null }

interface CalendarWeek {
  week_number: number; start_date: string; end_date: string; activity: string;
  gate_id: string | null; sprint_id: string | null; is_protected_week: number; is_current_week: boolean;
  required_output: string | null;
}

interface Checkin {
  id: string; checkin_date: string; guide_name: string;
  process_discipline_notes: string | null; git_commits_reviewed: string | null; flags: string[];
}

const ENGINE_STATUS_FLAG: Record<Engine['status'], string> = {
  PROPOSED: 'flag--warn', APPROVED: 'flag--ok', IN_PROGRESS: 'flag--ok', VALIDATED: 'flag--ok',
};

const DECISION_FLAG: Record<string, string> = { PASS: 'flag--ok', RESUBMIT: 'flag--warn' };

export function FoundationPanel({
  projectId, themeId, themeTitle, guideAllocatedHint, studentMembers, permissions, onDone,
}: {
  projectId: string; themeId: string | null; themeTitle: string | null;
  guideAllocatedHint: boolean; studentMembers: StudentMember[]; permissions: string[];
  onDone: (m: string) => void;
}) {
  const can = (p: string) => permissions.includes(p);
  const [error, setError] = useState<unknown>(null);
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [engines, setEngines] = useState<Engine[] | null>(null);
  const [dependencies, setDependencies] = useState<EngineDependency[]>([]);
  const [gates, setGates] = useState<{ gates: Gate[]; guideAllocated: boolean } | null>(null);
  const [checkins, setCheckins] = useState<Checkin[] | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [calendar, setCalendar] = useState<CalendarWeek[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [gatesResult, enginesResult, checkinsResult] = await Promise.all([
        api.get<{ gates: Gate[]; guideAllocated: boolean }>(`/projects/${projectId}/gates`),
        api.get<{ engines: Engine[]; dependencies: EngineDependency[] }>(`/projects/${projectId}/engines`),
        api.get<{ checkins: Checkin[] }>(`/projects/${projectId}/weekly-checkins`),
      ]);
      setGates(gatesResult);
      setEngines(enginesResult.engines);
      setDependencies(enginesResult.dependencies);
      setCheckins(checkinsResult.checkins);
    } catch (caught) {
      setError(caught);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const [themesResult, catalogResult, calendarResult] = await Promise.all([
          api.get<{ themes: Theme[] }>('/themes'),
          api.get<{ sprints: Sprint[] }>('/gates'),
          api.get<{ weeks: CalendarWeek[] }>('/gates/calendar'),
        ]);
        setThemes(themesResult.themes);
        setSprints(catalogResult.sprints);
        setCalendar(calendarResult.weeks);
      } catch (caught) {
        setError(caught);
      }
    })();
  }, []);

  async function afterChange(message: string) {
    await load();
    onDone(message);
  }

  if (error) return <ErrorMessage error={error} />;

  const guideAllocated = gates?.guideAllocated ?? guideAllocatedHint;
  const currentWeek = calendar.find((w) => w.is_current_week);

  return (
    <>
      {!guideAllocated && (
        <Alert kind="info" title="Locked until a guide is allocated">
          Theme confirmation, engine decomposition, gate reviews and weekly check-ins unlock once a coordinator
          assigns this project's Faculty Mentor guide (see the Team section on the Overview tab).
        </Alert>
      )}

      <Card
        title="Theme"
        hint="One of the ten Foundation Integration CSE themes, or an institute-authored custom theme. Confirmed by the guide."
      >
        {themeId ? (
          <p><strong>{themeTitle}</strong> — theme confirmed.</p>
        ) : (
          <p className="empty">No theme confirmed yet.</p>
        )}
        {can('project:assign_theme') && guideAllocated && (
          <ThemeAssignForm projectId={projectId} themes={themes} onDone={afterChange} />
        )}
      </Card>

      <Card
        title="Sprints &amp; COE calendar"
        hint="Sprint = shared execution window. Stage = technical maturity. Gate = marked review. They are three different ideas (Handbook Sec 1.11)."
      >
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sprint</th><th>Stages</th><th>Objective</th><th>Closes</th></tr></thead>
            <tbody>
              {sprints.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.stage_range}</td>
                  <td>{s.objective}</td>
                  <td>{s.closes_gate_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {currentWeek ? (
          <p className="card__hint" style={{ marginTop: 'var(--sp-2)' }}>
            Current week: <strong>Week {currentWeek.week_number}</strong> ({currentWeek.start_date} to {currentWeek.end_date}) — {currentWeek.activity}
            {currentWeek.is_protected_week ? <span className="flag flag--warn" style={{ marginLeft: '0.4rem' }}>protected week</span> : null}
          </p>
        ) : (
          <p className="card__hint" style={{ marginTop: 'var(--sp-2)' }}>No calendar week matches today's date.</p>
        )}
      </Card>

      <Card
        title="Engine decomposition"
        hint="An engine is one independently verifiable technical responsibility with a single student owner - not a screen, page or CRUD table (Handbook Sec 1.9)"
      >
        {(engines ?? []).length === 0 && <p className="empty">No engines defined yet.</p>}
        {(engines ?? []).map((engine) => (
          <div key={engine.id} className="panel" style={{ marginBottom: 'var(--sp-3)' }}>
            <h4>
              {engine.code} — {engine.name}{' '}
              <span className={`flag ${ENGINE_STATUS_FLAG[engine.status]}`}>{engine.status.replace('_', ' ').toLowerCase()}</span>
            </h4>
            <dl className="deflist">
              <div><dt>Responsibility</dt><dd>{engine.responsibility}</dd></div>
              <div><dt>Primary course</dt><dd>{engine.primary_course ?? <span className="rowsub">not recorded</span>}</dd></div>
              <div><dt>Owner</dt><dd>{engine.owner_display_name ?? engine.owner_team_identifier ?? <span className="rowsub">unassigned</span>}</dd></div>
              <div><dt>Inputs / Outputs</dt><dd>{engine.inputs ?? '—'} / {engine.outputs ?? '—'}</dd></div>
              <div><dt>Algorithm / mechanism</dt><dd>{engine.algorithm_mechanism ?? <span className="rowsub">not recorded</span>}</dd></div>
              <div><dt>Interface</dt><dd>{engine.interface_spec ?? <span className="rowsub">not recorded</span>}</dd></div>
              <div><dt>KPI target</dt><dd>{engine.kpi_target ?? <span className="rowsub">not recorded</span>}</dd></div>
              <div><dt>Failure case</dt><dd>{engine.failure_case ?? <span className="rowsub">not recorded</span>}</dd></div>
            </dl>
            {can('project:manage_engines') && engine.status === 'PROPOSED' && (
              <button
                type="button" className="btn--sm btn--primary"
                onClick={async () => {
                  try {
                    await api.patch(`/projects/${projectId}/engines/${engine.id}`, { status: 'APPROVED' });
                    await afterChange(`${engine.name} has been approved.`);
                  } catch (caught) { setError(caught); }
                }}
              >
                Approve
              </button>
            )}
          </div>
        ))}

        {dependencies.length > 0 && (
          <p className="card__hint" style={{ marginTop: 'var(--sp-2)' }}>
            Dependencies: {dependencies.map((d) => {
              const from = engines?.find((e) => e.id === d.engine_id)?.code ?? '?';
              const to = engines?.find((e) => e.id === d.depends_on_engine_id)?.code ?? '?';
              return `${from} → ${to}`;
            }).join(', ')}
          </p>
        )}

        {guideAllocated && (can('project:manage_engines') || can('engine:propose')) && (
          <EngineCreateForm projectId={projectId} canApprove={can('project:manage_engines')} onDone={afterChange} />
        )}

        {guideAllocated && can('project:manage_engines') && (engines?.length ?? 0) >= 2 && (
          <DependencyForm projectId={projectId} engines={engines ?? []} onDone={afterChange} />
        )}
      </Card>

      <Card
        title="Gate reviews"
        hint="The Foundation Integration framework's fixed Gate 0-4 checkpoints (50 marks total, per Handbook Sec 1.12). Gates open in sequence; a formal review is conducted by a Reviewer and marked per student."
      >
        {(gates?.gates ?? []).map((gate) => (
          <div key={gate.id} className="panel" style={{ marginBottom: 'var(--sp-3)' }}>
            <h4>
              {gate.name} <span className="flag">{gate.marks_weight} marks</span>
              {!gate.unlocked && <span className="flag flag--warn">locked</span>}
            </h4>
            <p className="rowsub">Maturity: {gate.stage_range} · CO: {gate.course_outcomes.join(', ')}</p>
            {gate.latestAttempt ? (
              <p>
                Attempt {gate.latestAttempt.attempt_number}:{' '}
                <span className={`flag ${DECISION_FLAG[gate.latestAttempt.decision]}`}>{gate.latestAttempt.decision.toLowerCase()}</span>
                {' '}by {gate.latestAttempt.reviewer_name}
                <br /><span className="rowsub">{gate.latestAttempt.comments}</span>
              </p>
            ) : (
              <p className="empty">Not yet attempted.</p>
            )}
            {can('project:conduct_gate_review') && guideAllocated && gate.unlocked
              && gate.latestAttempt?.decision !== 'PASS' && (
              <GateReviewForm projectId={projectId} gate={gate} studentMembers={studentMembers} onDone={afterChange} />
            )}
          </div>
        ))}
      </Card>

      <Card title="Weekly check-ins" hint="The guide's informal, continuous process-discipline log - distinct from a formal gate review">
        {(checkins ?? []).length === 0 && <p className="empty">No check-ins logged yet.</p>}
        <ul className="timeline">
          {(checkins ?? []).map((checkin) => (
            <li key={checkin.id}>
              <div className="when">{checkin.checkin_date.slice(0, 10)} · {checkin.guide_name}</div>
              {checkin.process_discipline_notes && <p>{checkin.process_discipline_notes}</p>}
              {checkin.git_commits_reviewed && <p><strong>Git commits reviewed:</strong> {checkin.git_commits_reviewed}</p>}
              {checkin.flags.length > 0 && (
                <p>{checkin.flags.map((f) => <span key={f} className="flag flag--warn" style={{ marginRight: '0.3rem' }}>{f.replace(/_/g, ' ').toLowerCase()}</span>)}</p>
              )}
            </li>
          ))}
        </ul>
        {can('project:log_checkin') && guideAllocated && (
          <CheckinForm projectId={projectId} onDone={afterChange} />
        )}
      </Card>
    </>
  );
}

function ThemeAssignForm({ projectId, themes, onDone }: { projectId: string; themes: Theme[] | null; onDone: (m: string) => void }) {
  const [themeId, setThemeId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const selected = themes?.find((t) => t.id === themeId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!themeId) return;
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/projects/${projectId}/theme`, { themeId });
      onDone('The theme has been confirmed.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-3)' }}>
      <ErrorMessage error={error} />
      <div className="field">
        <label htmlFor="theme-select">Choose a theme</label>
        <select id="theme-select" required value={themeId} onChange={(e) => setThemeId(e.target.value)}>
          <option value="">Select…</option>
          {(themes ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.title}{t.institute_id ? ' (institute custom)' : ''}</option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="card__hint">
          {selected.academic_subtitle}
          {selected.minimum_evidence.length > 0 && <> Minimum evidence: {selected.minimum_evidence.join(', ')}.</>}
        </p>
      )}
      <button type="submit" className="btn--primary" disabled={busy || !themeId}>
        {busy ? 'Confirming…' : 'Confirm theme'}
      </button>
    </form>
  );
}

/** The handbook's 13-field Engine Definition & Readiness Template (Sec 1.9). */
function EngineCreateForm({ projectId, canApprove, onDone }: { projectId: string; canApprove: boolean; onDone: (m: string) => void }) {
  const [fields, setFields] = useState({
    code: '', name: '', primaryCourse: '', responsibility: '', inputs: '', outputs: '',
    internalState: '', algorithmMechanism: '', interfaceSpec: '', dependenciesNote: '',
    kpiTarget: '', failureCase: '', validationMethod: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof fields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const trimmed = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim() || undefined]));
      await api.post(`/projects/${projectId}/engines`, trimmed);
      setFields({
        code: '', name: '', primaryCourse: '', responsibility: '', inputs: '', outputs: '',
        internalState: '', algorithmMechanism: '', interfaceSpec: '', dependenciesNote: '',
        kpiTarget: '', failureCase: '', validationMethod: '',
      });
      onDone(canApprove ? 'The engine has been saved.' : 'Your engine proposal has been submitted for guide approval.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-3)' }} className="panel">
      <ErrorMessage error={error} />
      <h4>{canApprove ? '+ New engine' : '+ Propose an engine you will own'}</h4>
      <p className="card__hint">
        All fields matter: an engine cannot be approved until inputs, outputs, algorithm/mechanism, interface, KPI
        target, failure case and an owner are all filled in (Handbook Sec 1.9.1's validity test).
      </p>
      <div className="filters">
        <div className="field">
          <label htmlFor="engine-code">Code</label>
          <input id="engine-code" type="text" required maxLength={10} placeholder="E1" value={fields.code} onChange={(e) => set('code', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="engine-name">Engine name</label>
          <input id="engine-name" type="text" required minLength={3} value={fields.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="engine-primary-course">Primary course</label>
          <input id="engine-primary-course" type="text" placeholder="OS / DSA / DBMS / Networks / Web" value={fields.primaryCourse} onChange={(e) => set('primaryCourse', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="engine-responsibility">Core responsibility</label>
        <textarea id="engine-responsibility" required minLength={10} value={fields.responsibility} onChange={(e) => set('responsibility', e.target.value)} />
      </div>
      <div className="filters">
        <div className="field">
          <label htmlFor="engine-inputs">Inputs</label>
          <input id="engine-inputs" type="text" value={fields.inputs} onChange={(e) => set('inputs', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="engine-outputs">Outputs</label>
          <input id="engine-outputs" type="text" value={fields.outputs} onChange={(e) => set('outputs', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="engine-internal-state">Internal state</label>
          <input id="engine-internal-state" type="text" value={fields.internalState} onChange={(e) => set('internalState', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="engine-algorithm">Algorithm / mechanism</label>
        <textarea id="engine-algorithm" value={fields.algorithmMechanism} onChange={(e) => set('algorithmMechanism', e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="engine-interface">Interface</label>
        <input id="engine-interface" type="text" placeholder="e.g. authorize(userId, resource, action) -> ALLOW | DENY" value={fields.interfaceSpec} onChange={(e) => set('interfaceSpec', e.target.value)} />
      </div>
      <div className="filters">
        <div className="field">
          <label htmlFor="engine-dependencies-note">Dependencies</label>
          <input id="engine-dependencies-note" type="text" value={fields.dependenciesNote} onChange={(e) => set('dependenciesNote', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="engine-kpi">KPI target</label>
          <input id="engine-kpi" type="text" value={fields.kpiTarget} onChange={(e) => set('kpiTarget', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="engine-failure-case">Failure case</label>
        <input id="engine-failure-case" type="text" placeholder="One realistic failure and the expected behaviour" value={fields.failureCase} onChange={(e) => set('failureCase', e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="engine-validation">Validation method</label>
        <input id="engine-validation" type="text" value={fields.validationMethod} onChange={(e) => set('validationMethod', e.target.value)} />
      </div>
      <button type="submit" className="btn--primary" disabled={busy}>
        {busy ? 'Saving…' : canApprove ? 'Save engine' : 'Propose engine'}
      </button>
    </form>
  );
}

function DependencyForm({ projectId, engines, onDone }: { projectId: string; engines: Engine[]; onDone: (m: string) => void }) {
  const [engineId, setEngineId] = useState('');
  const [dependsOnEngineId, setDependsOnEngineId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!engineId || !dependsOnEngineId) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/engines/${engineId}/dependencies`, { dependsOnEngineId });
      onDone('The dependency has been recorded.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-3)' }}>
      <ErrorMessage error={error} />
      <div className="filters">
        <div className="field">
          <label htmlFor="dep-engine">This engine…</label>
          <select id="dep-engine" required value={engineId} onChange={(e) => setEngineId(e.target.value)}>
            <option value="">Select…</option>
            {engines.map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dep-on">…depends on</label>
          <select id="dep-on" required value={dependsOnEngineId} onChange={(e) => setDependsOnEngineId(e.target.value)}>
            <option value="">Select…</option>
            {engines.map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ alignSelf: 'end' }}>
          <button type="submit" className="btn--sm" disabled={busy}>{busy ? 'Saving…' : 'Add dependency'}</button>
        </div>
      </div>
    </form>
  );
}

/** Per-student rubric marking, matching the Phase Assessment Sheet's "5 MARKS PER STUDENT" scheme. */
function GateReviewForm({
  projectId, gate, studentMembers, onDone,
}: { projectId: string; gate: Gate; studentMembers: StudentMember[]; onDone: (m: string) => void }) {
  const [decision, setDecision] = useState<'PASS' | 'RESUBMIT'>('PASS');
  const [comments, setComments] = useState('');
  const [ratings, setRatings] = useState<Record<string, Record<string, number>>>({});
  const [vivaNotes, setVivaNotes] = useState<Record<string, string>>({});
  const [selectedMembers, setSelectedMembers] = useState<string[]>(studentMembers.map((m) => m.id));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function setRating(memberId: string, criterion: string, value: number) {
    setRatings((prev) => ({ ...prev, [memberId]: { ...prev[memberId], [criterion]: value } }));
  }

  function marksFor(memberId: string) {
    const memberRatings = ratings[memberId] ?? {};
    return gate.criteria.reduce((sum, c) => sum + ((memberRatings[c.criterion_name] ?? 0) / 5) * c.weight_marks, 0);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const studentScores = selectedMembers.map((memberId) => ({
        memberId,
        criterionRatings: Object.fromEntries(gate.criteria.map((c) => [c.criterion_name, ratings[memberId]?.[c.criterion_name] ?? 0])),
        vivaNotes: vivaNotes[memberId]?.trim() || undefined,
      }));
      await api.post(`/projects/${projectId}/gates/${gate.id}/reviews`, { decision, comments, studentScores });
      onDone(`${gate.name} has been recorded.`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (studentMembers.length === 0) {
    return <p className="empty">Add an approved student team member before conducting this gate review.</p>;
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-2)' }}>
      <ErrorMessage error={error} />
      <div className="field">
        <label htmlFor={`gate-decision-${gate.id}`}>Team decision</label>
        <select id={`gate-decision-${gate.id}`} value={decision} onChange={(e) => setDecision(e.target.value as 'PASS' | 'RESUBMIT')}>
          <option value="PASS">Pass</option>
          <option value="RESUBMIT">Resubmit</option>
        </select>
      </div>

      {studentMembers.map((member) => {
        const label = member.name ?? member.team_identifier ?? member.id;
        const included = selectedMembers.includes(member.id);
        return (
          <div key={member.id} className="panel" style={{ marginTop: 'var(--sp-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
              <input
                type="checkbox" checked={included}
                onChange={() => setSelectedMembers((prev) => (included ? prev.filter((id) => id !== member.id) : [...prev, member.id]))}
              />
              {label} — {marksFor(member.id).toFixed(2)} / {gate.marks_weight} marks
            </label>
            {included && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Criterion</th><th>Weight</th><th>Rating (0-5)</th></tr></thead>
                    <tbody>
                      {gate.criteria.map((c) => (
                        <tr key={c.id}>
                          <td>{c.criterion_name}</td>
                          <td>{c.weight_marks}</td>
                          <td>
                            <select
                              aria-label={`${label} - ${c.criterion_name}`}
                              value={ratings[member.id]?.[c.criterion_name] ?? ''}
                              onChange={(e) => setRating(member.id, c.criterion_name, Number(e.target.value))}
                            >
                              <option value="" disabled>Select…</option>
                              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="field">
                  <label htmlFor={`viva-${gate.id}-${member.id}`}>Viva / individual understanding notes</label>
                  <input
                    id={`viva-${gate.id}-${member.id}`} type="text"
                    value={vivaNotes[member.id] ?? ''} onChange={(e) => setVivaNotes((prev) => ({ ...prev, [member.id]: e.target.value }))}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}

      <div className="field" style={{ marginTop: 'var(--sp-2)' }}>
        <label htmlFor={`gate-comments-${gate.id}`}>Reviewer comments (required)</label>
        <textarea id={`gate-comments-${gate.id}`} required minLength={10} value={comments} onChange={(e) => setComments(e.target.value)} />
      </div>
      <button type="submit" className="btn--primary" disabled={busy || selectedMembers.length === 0}>
        {busy ? 'Recording…' : `Record ${gate.name}`}
      </button>
    </form>
  );
}

function CheckinForm({ projectId, onDone }: { projectId: string; onDone: (m: string) => void }) {
  const [notes, setNotes] = useState('');
  const [commits, setCommits] = useState('');
  const [flags, setFlags] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function toggleFlag(flag: string) {
    setFlags((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/weekly-checkins`, {
        processDisciplineNotes: notes.trim() || undefined,
        gitCommitsReviewed: commits.trim() || undefined,
        flags: flags.length ? flags : undefined,
      });
      setNotes(''); setCommits(''); setFlags([]);
      onDone('The weekly check-in has been logged.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-3)' }}>
      <ErrorMessage error={error} />
      <div className="field">
        <label htmlFor="checkin-notes">Process discipline notes</label>
        <textarea id="checkin-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="checkin-commits">Git commits reviewed</label>
        <input id="checkin-commits" type="text" value={commits} onChange={(e) => setCommits(e.target.value)} />
      </div>
      <div className="field">
        <label>Flags</label>
        <div className="btn-row">
          {(['BULK_COMMIT', 'POST_DATED_DOC', 'UNDOCUMENTED_DESIGN_CHANGE'] as const).map((flag) => (
            <label key={flag} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={flags.includes(flag)} onChange={() => toggleFlag(flag)} />
              {flag.replace(/_/g, ' ').toLowerCase()}
            </label>
          ))}
        </div>
      </div>
      <button type="submit" className="btn--primary" disabled={busy}>
        {busy ? 'Logging…' : 'Log check-in'}
      </button>
    </form>
  );
}
