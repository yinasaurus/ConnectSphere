import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { LAYOUTS, ROLES } from '../constants';

const emptyForm = {
  name: '',
  location: '',
  capacity: 0,
  facilities: '',
  accessibility: '',
  operatingHours: '',
  setupMinutes: 30,
  teardownMinutes: 30,
  isActive: true,
  layouts: [],
};

const EMPTY_SEARCH = {
  startAt: '',
  endAt: '',
  capacityMin: '',
  location: '',
  accessibility: '',
  layout: '',
  facilities: '',
};

function venueForm(venue) {
  return {
    name: venue.name || '',
    location: venue.location || '',
    capacity: venue.capacity ?? 0,
    facilities: venue.facilities || '',
    accessibility: venue.accessibility || '',
    operatingHours: venue.operatingHours || '',
    setupMinutes: venue.setupMinutes ?? 30,
    teardownMinutes: venue.teardownMinutes ?? 30,
    isActive: venue.isActive !== false,
    updatedAt: venue.updatedAt || '',
    layouts: (venue.layoutDetails || venue.layouts || []).map((layout) => (
      typeof layout === 'string' ? { layout } : { id: layout.id, layout: layout.layout }
    )),
  };
}
export default function Venues() {
  const { hasRole } = useAuth();
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [form, setForm] = useState({
    name: '',
    location: '',
    capacity: 50,
    accessibility: 'Wheelchair access',
    layouts: ['THEATRE'],
  });
  const [selectedId, setSelectedId] = useState(null);
  const [updateForm, setUpdateForm] = useState(emptyForm);
  const [newLayout, setNewLayout] = useState('');
  const [error, setError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [saveToast, setSaveToast] = useState('');
  const [saving, setSaving] = useState(false);
  const updateCardRef = useRef(null);

  const [searchForm, setSearchForm] = useState(EMPTY_SEARCH);
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  async function reload() {
    const [venueRes, bookingRes] = await Promise.all([
      api('/api/venues'),
      api('/api/venues/bookings'),
    ]);
    setVenues(venueRes.venues || []);
    setBookings(bookingRes.bookings || []);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  function selectVenue(venue) {
    setSelectedId(venue.id);
    setUpdateForm(venueForm(venue));
    setError('');
    setUpdateError('');
    setSaveToast('');
    requestAnimationFrame(() => updateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function setUpdateField(field, value) {
    setUpdateForm((current) => ({ ...current, [field]: value }));
  }

  function numberValue(value) {
    return value === '' ? '' : Number(value);
  }

  function updateLayout(index, value) {
    setUpdateForm((current) => ({
      ...current,
      layouts: current.layouts.map((layout, layoutIndex) => (
        layoutIndex === index ? { ...layout, layout: value } : layout
      )),
    }));
  }

  function deleteLayout(index) {
    setUpdateForm((current) => ({
      ...current,
      layouts: current.layouts.map((layout, layoutIndex) => (
        layoutIndex === index ? { ...layout, deleted: true } : layout
      )),
    }));
  }

  function addLayout() {
    const layout = newLayout.trim();
    if (!layout) return;
    setUpdateForm((current) => ({
      ...current,
      layouts: [...current.layouts, { layout }],
    }));
    setNewLayout('');
  }

  async function saveUpdate() {
    if (!selectedId) return;
    setSaving(true);
    setError('');
    setUpdateError('');
    try {
      // The backend owns updated_at; do not send the read-only display value back in a strict PATCH body.
      const updatePayload = { ...updateForm };
      delete updatePayload.updatedAt;
      // The backend uses layout IDs to update or delete existing rows and inserts ID-less layouts.
      await api(`/api/venues/${selectedId}`, { method: 'PATCH', body: updatePayload });
      await reload();
      const refreshed = (await api('/api/venues')).venues?.find((venue) => venue.id === selectedId);
      if (refreshed) setUpdateForm(venueForm(refreshed));
      setSaveToast(`${updatePayload.name} updated`);
      window.setTimeout(() => setSaveToast(''), 2500);
    } catch (err) {
      setUpdateError(err.details?.map((detail) => `${detail.field}: ${detail.message}`).join(' ') || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    if (Boolean(searchForm.startAt) !== Boolean(searchForm.endAt)) {
      setSearchError('Pick both a start and an end date/time, or neither.');
      return;
    }

    setSearching(true);
    setSearchError('');
    try {
      const params = new URLSearchParams();
      if (searchForm.startAt && searchForm.endAt) {
        params.set('startAt', new Date(searchForm.startAt).toISOString());
        params.set('endAt', new Date(searchForm.endAt).toISOString());
      }
      if (searchForm.capacityMin) params.set('capacityMin', searchForm.capacityMin);
      if (searchForm.location) params.set('location', searchForm.location);
      if (searchForm.accessibility) params.set('accessibility', searchForm.accessibility);
      if (searchForm.layout) params.set('layout', searchForm.layout);
      if (searchForm.facilities) params.set('facilities', searchForm.facilities);

      const res = await api(`/api/venues/search?${params.toString()}`);
      setSearchResults(res.venues || []);
    } catch (err) {
      setSearchResults(null);
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchForm(EMPTY_SEARCH);
    setSearchResults(null);
    setSearchError('');
  }
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Venues</h1>
          <p>Catalogue, layouts, and booking queue. Conflict checks include setup and turnaround time.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {error && <div className="alert">{error}</div>}
      {saveToast && (
        <div className="venue-save-toast" role="status">
          <span className="venue-save-toast-check" aria-hidden="true">✓</span>
          {saveToast}
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Search available venues</h3>
        <p className="muted">
          Filtering is strict: a venue must match every filter you set. Add a date and time to
          also check availability (setup/turnaround time, confirmed bookings, tentative holds,
          and unavailability periods are all accounted for).
        </p>
        <form onSubmit={runSearch} className="grid-2">
          <div className="stack">
            <label className="muted">Event start</label>
            <input
              type="datetime-local"
              value={searchForm.startAt}
              onChange={(e) => setSearchForm({ ...searchForm, startAt: e.target.value })}
            />
            <label className="muted">Event end</label>
            <input
              type="datetime-local"
              value={searchForm.endAt}
              onChange={(e) => setSearchForm({ ...searchForm, endAt: e.target.value })}
            />
            <label className="muted">Minimum capacity</label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 50"
              value={searchForm.capacityMin}
              onChange={(e) => setSearchForm({ ...searchForm, capacityMin: e.target.value })}
            />
          </div>
          <div className="stack">
            <label className="muted">Location</label>
            <input
              placeholder="e.g. Level 2"
              value={searchForm.location}
              onChange={(e) => setSearchForm({ ...searchForm, location: e.target.value })}
            />
            <label className="muted">Accessibility</label>
            <input
              placeholder="e.g. Wheelchair access"
              value={searchForm.accessibility}
              onChange={(e) => setSearchForm({ ...searchForm, accessibility: e.target.value })}
            />
            <label className="muted">Room layout</label>
            <select
              value={searchForm.layout}
              onChange={(e) => setSearchForm({ ...searchForm, layout: e.target.value })}
            >
              <option value="">Any layout</option>
              {LAYOUTS.map((layout) => <option key={layout}>{layout}</option>)}
            </select>
            <label className="muted">Facilities (comma-separated)</label>
            <input
              placeholder="e.g. Projector, Audio"
              value={searchForm.facilities}
              onChange={(e) => setSearchForm({ ...searchForm, facilities: e.target.value })}
            />
          </div>
          <div className="stack" style={{ gridColumn: '1 / -1', flexDirection: 'row' }}>
            <button className="btn" type="submit" disabled={searching}>
              {searching ? 'Searching…' : 'Search venues'}
            </button>
            <button className="btn ghost" type="button" onClick={clearSearch}>
              Clear
            </button>
          </div>
        </form>

        {searchError && <div className="alert" style={{ marginTop: 12 }}>{searchError}</div>}

        {searchResults !== null && (
          <div style={{ marginTop: 18 }}>
            <h3>Results</h3>
            {searchResults.length === 0 ? (
              <p className="muted">No venues match your selected filters.</p>
            ) : (
              <div className="cards">
                {searchResults.map((venue) => (
                  <div className="card" key={venue.id}>
                    <h3>{venue.name}</h3>
                    <p className="muted">{venue.location}</p>
                    <p>Capacity {venue.capacity}</p>
                    <p>{venue.accessibility}</p>
                    <div className="roles">
                      {(venue.layouts || []).map((layout) => <span className="pill" key={layout}>{layout}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <h2>Full catalogue</h2>
      <div className="cards">
        {venues.map((venue) => (
          <button
            className="card venue-card"
            key={venue.id}
            type="button"
            onClick={() => selectVenue(venue)}
            aria-pressed={selectedId === venue.id}
          >
            <h3>{venue.name}</h3>
            <p className="muted">{venue.location}</p>
            <p>Capacity {venue.capacity}</p>
            <p>{venue.accessibility}</p>
            <div className="roles">
              {(venue.layouts || []).map((layout) => <span className="pill" key={layout}>{layout}</span>)}
            </div>
          </button>
        ))}
      </div>

      {hasRole(ROLES.VENUE_STAFF) && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>Add venue</h3>
          <div className="grid-2">
            <div className="stack">
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <input type="number" min="0" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: numberValue(e.target.value) })} />
            </div>
            <div className="stack">
              <textarea value={form.accessibility} onChange={(e) => setForm({ ...form, accessibility: e.target.value })} />
              <select value={form.layouts[0]} onChange={(e) => setForm({ ...form, layouts: [e.target.value] })}>
                {LAYOUTS.map((layout) => <option key={layout}>{layout}</option>)}
              </select>
              <button className="btn" onClick={async () => {
                try {
                  await api('/api/venues', { method: 'POST', body: form });
                  setForm({ ...form, name: '' });
                  await reload();
                } catch (err) {
                  setError(err.message);
                }
              }}
              >
                Save venue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Booking requests</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Venue</th>
              <th>Status</th>
              <th>Window</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td>{booking.event_name}</td>
                <td>{booking.venue_name}</td>
                <td>{booking.status}</td>
                <td>{new Date(booking.start_at).toLocaleString()}</td>
              </tr>
            ))}
            {!bookings.length && <tr><td colSpan="4" className="muted">No bookings yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {hasRole(ROLES.VENUE_STAFF) && (
        <div className="card venue-update-card" ref={updateCardRef} style={{ marginTop: 18 }}>
          {!selectedId ? (
            <p className="venue-empty-state">Select a venue card from the catalogue above to edit its details.</p>
          ) : (
            <>
              {updateError && <div className="alert">{updateError}</div>}
              <div className="row-between">
                <div>
                  <h3>Update venue</h3>
                  <p className="muted">Edit venue information and supported layouts.</p>
                </div>
                <div className="roles">
                  <span className="pill">{updateForm.isActive ? 'Active' : 'Inactive'}</span>
                  {updateForm.updatedAt && <span className="pill">Updated {new Date(updateForm.updatedAt).toLocaleString()}</span>}
                </div>
              </div>
              <div className="grid-2">
                <div className="stack">
                  <label>Venue name<input value={updateForm.name} onChange={(e) => setUpdateField('name', e.target.value)} /></label>
                  <label>Location<input value={updateForm.location} onChange={(e) => setUpdateField('location', e.target.value)} /></label>
                  <label>Capacity<input type="number" min="0" value={updateForm.capacity} onChange={(e) => setUpdateField('capacity', numberValue(e.target.value))} /></label>
                  <label>Operating hours<input value={updateForm.operatingHours} onChange={(e) => setUpdateField('operatingHours', e.target.value)} placeholder="08:00 - 22:00" /></label>
                  <div className="grid-2">
                    <label>Setup (mins)<input type="number" min="0" value={updateForm.setupMinutes} onChange={(e) => setUpdateField('setupMinutes', numberValue(e.target.value))} /></label>
                    <label>Teardown (mins)<input type="number" min="0" value={updateForm.teardownMinutes} onChange={(e) => setUpdateField('teardownMinutes', numberValue(e.target.value))} /></label>
                  </div>
                </div>
                <div className="stack">
                  <label>Facilities<textarea value={updateForm.facilities} onChange={(e) => setUpdateField('facilities', e.target.value)} /></label>
                  <label>Accessibility<textarea value={updateForm.accessibility} onChange={(e) => setUpdateField('accessibility', e.target.value)} /></label>
                  <label>Supported layouts</label>
                  <div className="roles">
                    {updateForm.layouts.map((layout, index) => !layout.deleted && (
                      <span className="pill" key={layout.id || `new-${index}`}>
                        {layout.id ? (
                          <input value={layout.layout} onChange={(e) => updateLayout(index, e.target.value)} />
                        ) : layout.layout}
                        <button type="button" className="layout-remove" onClick={() => deleteLayout(index)} aria-label={`Delete ${layout.layout}`}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="actions">
                    <input placeholder="Add layout" value={newLayout} onChange={(e) => setNewLayout(e.target.value)} />
                    <button type="button" className="btn secondary" onClick={addLayout}>Add layout</button>
                  </div>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={updateForm.isActive} onChange={(e) => setUpdateField('isActive', e.target.checked)} />
                    Venue is active
                  </label>
                </div>
              </div>
              <div className="actions venue-update-actions">
                <button className="btn ghost" type="button" onClick={() => setSelectedId(null)}>Cancel</button>
                <button className="btn" type="button" disabled={saving} onClick={saveUpdate}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
