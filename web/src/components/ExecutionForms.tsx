import { useState } from 'react';
import { api, type ProjectDetail } from '../api';
import { ErrorMessage } from './ui';

/**
 * Milestone and KPI entry (requirement 5.5, "Execution" and "KPI evidence").
 * A KPI measurement always requires evidence and an explicit meets-target
 * judgement, so the recorded number can be traced back to something.
 */
export function ExecutionForms({
  project, onDone,
}: { project: ProjectDetail; onDone: (message: string) => void }) {
  if (!project.permissions.includes('project:update')) return null;
  return (
    <>
      <AddMilestone project={project} onDone={onDone} />
      {project.milestones.length > 0 && <UpdateMilestone project={project} onDone={onDone} />}
      <AddKpi project={project} onDone={onDone} />
      {project.kpis.length > 0 && <RecordMeasurement project={project} onDone={onDone} />}
    </>
  );
}

function AddMilestone({ project, onDone }: { project: ProjectDetail; onDone: (m: string) => void }) {
  const [form, setForm] = useState({ title: '', description: '', plannedDate: '', isCritical: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${project.project.id}/milestones`, {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        plannedDate: form.plannedDate || undefined,
        // Appended to the end of the existing sequence.
        sequence: project.milestones.length,
        isCritical: form.isCritical,
      });
      setForm({ title: '', description: '', plannedDate: '', isCritical: false });
      onDone('The milestone has been added.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Add a milestone</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="field">
          <label htmlFor="ms-title">Milestone (required)</label>
          <input
            id="ms-title" type="text" required minLength={3}
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="ms-desc">Description</label>
          <textarea id="ms-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="filters">
          <div className="field">
            <label htmlFor="ms-date">Planned date</label>
            <input id="ms-date" type="date" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} />
          </div>
          <label className="field field--inline">
            <input type="checkbox" checked={form.isCritical} onChange={(e) => setForm({ ...form, isCritical: e.target.checked })} />
            Critical milestone
          </label>
        </div>
        <p className="hint">
          A missed critical milestone is one of the stated criteria for a Red status, so mark
          milestones critical only when that is true.
        </p>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add milestone'}
        </button>
      </form>
    </details>
  );
}

function UpdateMilestone({ project, onDone }: { project: ProjectDetail; onDone: (m: string) => void }) {
  const [milestoneId, setMilestoneId] = useState(project.milestones[0]?.id ?? '');
  const selected = project.milestones.find((m) => m.id === milestoneId);
  const [status, setStatus] = useState(selected?.status ?? 'UPCOMING');
  const [actualDate, setActualDate] = useState(selected?.actual_date ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function pick(id: string) {
    setMilestoneId(id);
    const next = project.milestones.find((m) => m.id === id);
    setStatus(next?.status ?? 'UPCOMING');
    setActualDate(next?.actual_date ?? '');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/projects/${project.project.id}/milestones/${milestoneId}`, {
        status,
        actualDate: actualDate || null,
      });
      onDone('The milestone has been updated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Update a milestone</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="field">
          <label htmlFor="msu-pick">Milestone</label>
          <select id="msu-pick" value={milestoneId} onChange={(e) => pick(e.target.value)}>
            {project.milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </div>
        <div className="filters">
          <div className="field">
            <label htmlFor="msu-status">Status</label>
            <select id="msu-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="UPCOMING">Upcoming</option>
              <option value="CURRENT">Current</option>
              <option value="COMPLETED">Completed</option>
              <option value="MISSED">Missed</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="msu-actual">Actual date</label>
            <input id="msu-actual" type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn--primary" disabled={busy || !milestoneId}>
          {busy ? 'Saving…' : 'Update milestone'}
        </button>
      </form>
    </details>
  );
}

function AddKpi({ project, onDone }: { project: ProjectDetail; onDone: (m: string) => void }) {
  const [form, setForm] = useState({ name: '', definition: '', targetValue: '', unit: '', accountableName: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${project.project.id}/kpis`, {
        name: form.name.trim(),
        definition: form.definition.trim() || undefined,
        targetValue: form.targetValue.trim(),
        unit: form.unit.trim() || undefined,
        accountableName: form.accountableName.trim() || undefined,
      });
      setForm({ name: '', definition: '', targetValue: '', unit: '', accountableName: '' });
      onDone('The KPI has been added.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Add a KPI</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="field">
          <label htmlFor="kpi-name">KPI name (required)</label>
          <input id="kpi-name" type="text" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="kpi-def">How it is measured</label>
          <textarea id="kpi-def" value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} />
        </div>
        <div className="filters">
          <div className="field">
            <label htmlFor="kpi-target">Target (required)</label>
            <input id="kpi-target" type="text" required placeholder="&gt; 80" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="kpi-unit">Unit</label>
            <input id="kpi-unit" type="text" placeholder="%" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="kpi-owner">Accountable owner</label>
            <input id="kpi-owner" type="text" value={form.accountableName} onChange={(e) => setForm({ ...form, accountableName: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add KPI'}
        </button>
      </form>
    </details>
  );
}

function RecordMeasurement({ project, onDone }: { project: ProjectDetail; onDone: (m: string) => void }) {
  const [kpiId, setKpiId] = useState(project.kpis[0]?.id ?? '');
  const [measuredValue, setMeasuredValue] = useState('');
  const [measurementDate, setMeasurementDate] = useState(new Date().toISOString().slice(0, 10));
  const [evidence, setEvidence] = useState('');
  const [meetsTarget, setMeetsTarget] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const kpi = project.kpis.find((k) => k.id === kpiId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${project.project.id}/kpis/${kpiId}/measurements`, {
        measuredValue: measuredValue.trim(),
        measurementDate,
        evidence: evidence.trim(),
        meetsTarget,
      });
      setMeasuredValue('');
      setEvidence('');
      setMeetsTarget(false);
      onDone('The measurement has been recorded.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Record a KPI measurement</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="field">
          <label htmlFor="km-kpi">KPI</label>
          <select id="km-kpi" value={kpiId} onChange={(e) => setKpiId(e.target.value)}>
            {project.kpis.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          {kpi && (
            <p className="hint" style={{ marginTop: 'var(--sp-1)', marginBottom: 0 }}>
              Target: {kpi.target_value}{kpi.unit ? ` ${kpi.unit}` : ''}
            </p>
          )}
        </div>
        <div className="filters">
          <div className="field">
            <label htmlFor="km-value">Measured value (required)</label>
            <input id="km-value" type="text" required value={measuredValue} onChange={(e) => setMeasuredValue(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="km-date">Measurement date (required)</label>
            <input id="km-date" type="date" required value={measurementDate} onChange={(e) => setMeasurementDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="km-evidence">Evidence (required)</label>
          <p className="hint">Where this number came from — a test log, a demonstration, a report.</p>
          <textarea id="km-evidence" required minLength={5} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </div>
        <label className="field field--inline">
          <input type="checkbox" checked={meetsTarget} onChange={(e) => setMeetsTarget(e.target.checked)} />
          This measurement meets the target
        </label>
        <div className="btn-row">
          <button type="submit" className="btn--primary" disabled={busy || !kpiId}>
            {busy ? 'Recording…' : 'Record measurement'}
          </button>
        </div>
      </form>
    </details>
  );
}
