import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { CATEGORIES, LAYOUTS } from '../constants';

const empty = {
  name: '',
  description: '',
  purpose: '',
  category: 'WORKSHOP',
  startAt: '',
  endAt: '',
  expectedAttendance: 40,
  accessibilityNeeds: '',
  layoutPreference: 'THEATRE',
  venueRequirements: '',
  equipmentNotes: '',
  specialRequests: '',
  registrationRequired: true,
  clonedFromEventId: '',
};

// SCUM-14: mirrors backend REQUIRED_FOR_SUBMISSION in events.service.js.
// Draft saves (SCUM-15) skip this check entirely.
const REQUIRED_FOR_SUBMISSION = [
  { field: 'name', label: 'Event name' },
  { field: 'purpose', label: 'Purpose' },
  { field: 'description', label: 'Description' },
  { field: 'startAt', label: 'Start date/time' },
  { field: 'endAt', label: 'End date/time' },
  { field: 'expectedAttendance', label: 'Expected attendance' },
  { field: 'venueRequirements', label: 'Venue requirements' },
  { field: 'accessibilityNeeds', label: 'Accessibility requirements' },
];

function findMissingFields(form) {
  return REQUIRED_FOR_SUBMISSION.filter(({ field }) => {
    const value = form[field];
    if (field === 'expectedAttendance') return !value || Number(value) <= 0;
    return value === null || value === undefined || String(value).trim() === '';
  });
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function NewEvent() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const [form, setForm] = useState(empty);
  const [previous, setPrevious] = useState([]);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/events').then((data) => setPrevious(data.events || []));
  }, []);

  useEffect(() => {
    if (!isEditing) return;
    api(`/api/events/${id}`).then(({ event }) => {
      setForm({
        ...empty,
        ...event,
        startAt: toDateTimeLocal(event.startAt),
        endAt: toDateTimeLocal(event.endAt),
        clonedFromEventId: event.clonedFromEventId || '',
      });
    }).catch((err) => setError(err.message));
  }, [id, isEditing]);

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function fieldClass(field) {
    return fieldErrors[field] ? 'field-error' : '';
  }

  async function save(submitAfter) {
    setError('');

    if (submitAfter) {
      const missing = findMissingFields(form);
      if (missing.length) {
        setFieldErrors(Object.fromEntries(missing.map((m) => [m.field, m.label])));
        setError(`Complete required fields before submitting: ${missing.map((m) => m.label).join(', ')}`);
        return;
      }
    }
    setFieldErrors({});

    setBusy(true);
    try {
      const payload = {
        ...form,
        clonedFromEventId: form.clonedFromEventId || null,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      };

      const { event } = isEditing
        ? await api(`/api/events/${id}`, { method: 'PATCH', body: payload })
        : await api('/api/events', { method: 'POST', body: payload });

      if (submitAfter) {
        await api(`/api/events/${event.id}/submit`, { method: 'POST' });
        navigate(`/app/events/${event.id}`);
      } else {
        navigate('/app/drafts');
      }
    } catch (err) {
      setError(err.message);
      if (err.details?.fields) {
        setFieldErrors(Object.fromEntries(
          err.details.fields.map((field) => {
            const match = REQUIRED_FOR_SUBMISSION.find((item) => item.field === field);
            return [field, match ? match.label : field];
          })
        ));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{isEditing ? 'Edit event request' : 'New event request'}</h1>
          <p>Save as draft anytime. Submission auto-assigns a coordinator (least current load).</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="grid-2">
        <div className="card stack">
          {!isEditing && (
            <>
              <label>Reuse a previous event</label>
              <select value={form.clonedFromEventId} onChange={(e) => {
                const cloneId = e.target.value;
                set('clonedFromEventId', cloneId);
                const source = previous.find((event) => String(event.id) === cloneId);
                if (source) {
                  setForm((current) => ({
                    ...current,
                    clonedFromEventId: cloneId,
                    name: `${source.name} (copy)`,
                    description: source.description || '',
                    purpose: source.purpose || '',
                    category: source.category || 'OTHER',
                    expectedAttendance: source.expectedAttendance || 0,
                    accessibilityNeeds: source.accessibilityNeeds || '',
                    layoutPreference: source.layoutPreference || 'THEATRE',
                    venueRequirements: source.venueRequirements || '',
                    equipmentNotes: source.equipmentNotes || '',
                    specialRequests: source.specialRequests || '',
                  }));
                }
              }}
              >
                <option value="">Start from scratch</option>
                {previous.map((event) => (
                  <option key={event.id} value={event.id}>{event.name}</option>
                ))}
              </select>
            </>
          )}
          <label>Event name *</label>
          <input className={fieldClass('name')} value={form.name} onChange={(e) => set('name', e.target.value)} />
          {fieldErrors.name && <span className="field-hint">{fieldErrors.name} is required.</span>}
          <label>Purpose *</label>
          <input className={fieldClass('purpose')} value={form.purpose} onChange={(e) => set('purpose', e.target.value)} />
          {fieldErrors.purpose && <span className="field-hint">{fieldErrors.purpose} is required.</span>}
          <label>Description *</label>
          <textarea className={fieldClass('description')} value={form.description} onChange={(e) => set('description', e.target.value)} />
          {fieldErrors.description && <span className="field-hint">{fieldErrors.description} is required.</span>}
          <label>Category</label>
          <select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="card stack">
          <label>Start *</label>
          <input className={fieldClass('startAt')} type="datetime-local" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
          {fieldErrors.startAt && <span className="field-hint">{fieldErrors.startAt} is required.</span>}
          <label>End *</label>
          <input className={fieldClass('endAt')} type="datetime-local" value={form.endAt} onChange={(e) => set('endAt', e.target.value)} />
          {fieldErrors.endAt && <span className="field-hint">{fieldErrors.endAt} is required.</span>}
          <label>Expected attendance *</label>
          <input className={fieldClass('expectedAttendance')} type="number" value={form.expectedAttendance} onChange={(e) => set('expectedAttendance', Number(e.target.value))} />
          {fieldErrors.expectedAttendance && <span className="field-hint">{fieldErrors.expectedAttendance} must be greater than zero.</span>}
          <label>Layout preference</label>
          <select value={form.layoutPreference} onChange={(e) => set('layoutPreference', e.target.value)}>
            {LAYOUTS.map((item) => <option key={item}>{item}</option>)}
          </select>
          <label>Accessibility needs *</label>
          <textarea className={fieldClass('accessibilityNeeds')} value={form.accessibilityNeeds} onChange={(e) => set('accessibilityNeeds', e.target.value)} placeholder="Wheelchair access, reserved seating, mobility arrangements… (enter 'None' if not applicable)" />
          {fieldErrors.accessibilityNeeds && <span className="field-hint">{fieldErrors.accessibilityNeeds} is required — enter &quot;None&quot; if not applicable.</span>}
          <label>Venue requirements *</label>
          <textarea className={fieldClass('venueRequirements')} value={form.venueRequirements} onChange={(e) => set('venueRequirements', e.target.value)} />
          {fieldErrors.venueRequirements && <span className="field-hint">{fieldErrors.venueRequirements} is required.</span>}
          <label>Equipment notes</label>
          <textarea value={form.equipmentNotes} onChange={(e) => set('equipmentNotes', e.target.value)} />
          <label>
            <input type="checkbox" checked={form.registrationRequired} onChange={(e) => set('registrationRequired', e.target.checked)} />
            {' '}Attendee registration required
          </label>
          <div className="actions">
            <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save as draft</button>
            <button className="btn" disabled={busy} onClick={() => save(true)}>Submit for review</button>
          </div>
        </div>
      </div>
    </>
  );
}
