import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function NewEvent() {
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [previous, setPrevious] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/events').then((data) => setPrevious(data.events || []));
  }, []);

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(submitAfter) {
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        clonedFromEventId: form.clonedFromEventId || null,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      };
      const { event } = await api('/api/events', { method: 'POST', body: payload });
      if (submitAfter) {
        await api(`/api/events/${event.id}/submit`, { method: 'POST' });
      }
      navigate(`/app/events/${event.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>New event request</h1>
          <p>Save as draft anytime. Submission auto-assigns a coordinator (least current load).</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="grid-2">
        <div className="card stack">
          <label>Reuse a previous event</label>
          <select value={form.clonedFromEventId} onChange={(e) => {
            const id = e.target.value;
            set('clonedFromEventId', id);
            const source = previous.find((event) => String(event.id) === id);
            if (source) {
              setForm((current) => ({
                ...current,
                clonedFromEventId: id,
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
          <label>Event name</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
          <label>Purpose</label>
          <input value={form.purpose} onChange={(e) => set('purpose', e.target.value)} />
          <label>Description</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
          <label>Category</label>
          <select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="card stack">
          <label>Start</label>
          <input type="datetime-local" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
          <label>End</label>
          <input type="datetime-local" value={form.endAt} onChange={(e) => set('endAt', e.target.value)} />
          <label>Expected attendance</label>
          <input type="number" value={form.expectedAttendance} onChange={(e) => set('expectedAttendance', Number(e.target.value))} />
          <label>Layout preference</label>
          <select value={form.layoutPreference} onChange={(e) => set('layoutPreference', e.target.value)}>
            {LAYOUTS.map((item) => <option key={item}>{item}</option>)}
          </select>
          <label>Accessibility needs</label>
          <textarea value={form.accessibilityNeeds} onChange={(e) => set('accessibilityNeeds', e.target.value)} placeholder="Wheelchair access, reserved seating, mobility arrangements…" />
          <label>Venue requirements</label>
          <textarea value={form.venueRequirements} onChange={(e) => set('venueRequirements', e.target.value)} />
          <label>Equipment notes</label>
          <textarea value={form.equipmentNotes} onChange={(e) => set('equipmentNotes', e.target.value)} />
          <label>
            <input type="checkbox" checked={form.registrationRequired} onChange={(e) => set('registrationRequired', e.target.checked)} />
            {' '}Attendee registration required
          </label>
          <div className="actions">
            <button className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn" disabled={busy} onClick={() => save(true)}>Submit for review</button>
          </div>
        </div>
      </div>
    </>
  );
}
