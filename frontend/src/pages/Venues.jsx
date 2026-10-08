import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import ConflictModal from '../components/ConflictModal';
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

const EMPTY_SEARCH = {
  startAt: '',
  endAt: '',
  capacityMin: '',
  location: '',
  accessibility: '',
  layout: '',
  facilities: '',
};

/** SCRUM-18: per-booking status badge with colour-coded pill. */
function BookingStatusBadge({ status }) {
  const colours = {
    PENDING: '#b45309',
    APPROVED: '#15803d',
    REJECTED: '#b91c1c',
    TENTATIVE: '#1d4ed8',
    CANCELLED: '#6b7280',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: '0.78rem',
        fontWeight: 600,
        background: colours[status] || '#374151',
        color: '#fff',
      }}
    >
      {status}
    </span>
  );
}

/**
 * SCRUM-18 AC2/AC3: one card per pending booking shown to Venue Staff.
 * Displays event, venue, date, time, and booking window so staff have full context
 * before deciding. Each card has its own reason/alternative inputs and Approve/Reject
 * buttons so bookings are decided independently (AC9).
 */
function PendingBookingCard({ booking, onDecide }) {
  const [reason, setReason] = useState('');
  const [alternative, setAlternative] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [localError, setLocalError] = useState('');

  async function decide(approve) {
    setDeciding(true);
    setLocalError('');
    try {
      await onDecide(booking.id, approve, reason.trim() || undefined, alternative.trim() || undefined);
      setReason('');
      setAlternative('');
    } catch (err) {
      if (err.code !== 'BOOKING_CONFLICT') setLocalError(err.message);
    } finally {
      setDeciding(false);
    }
  }

  const bookingWindow = `${new Date(booking.start_at).toLocaleString()} – ${new Date(booking.end_at).toLocaleString()}`;
  const eventWindow = booking.event_start_at
    ? `${new Date(booking.event_start_at).toLocaleString()} – ${new Date(booking.event_end_at).toLocaleString()}`
    : 'TBC';

  return (
    <div
      style={{
        border: '1px solid #fcd34d',
        borderRadius: 10,
        padding: '16px 20px',
        background: 'rgba(251,191,36,0.06)',
        marginBottom: 14,
      }}
      data-testid={`pending-booking-${booking.id}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 2 }}>
            {booking.event_name || `Event #${booking.event_id}`}
          </div>
          <div className="muted" style={{ fontSize: '0.85rem', marginBottom: 6 }}>
            {booking.venue_name || `Venue #${booking.venue_id}`}
          </div>
          {booking.has_conflict ? (
            <p style={{ color: '#b91c1c', fontWeight: 600, fontSize: '0.85rem', margin: '4px 0' }}>
              ⚠️ Conflict with {booking.conflict_details?.eventName || 'confirmed booking'}
            </p>
          ) : (
            <p style={{ color: '#15803d', fontSize: '0.85rem', margin: '4px 0' }}>✓ No conflict</p>
          )}
          <p style={{ margin: '3px 0', fontSize: '0.88rem' }}>
            <strong>Booking window:</strong> {bookingWindow}
          </p>
          <p style={{ margin: '3px 0', fontSize: '0.88rem' }}>
            <strong>Event date:</strong> {eventWindow}
          </p>
          {booking.notes && (
            <p style={{ margin: '3px 0', fontSize: '0.88rem' }}>
              <strong>Notes:</strong> {booking.notes}
            </p>
          )}
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>

      {localError && <div className="alert" style={{ marginTop: 10 }}>{localError}</div>}

      <div style={{ marginTop: 14 }}>
        <label
          htmlFor={`reason-${booking.id}`}
          style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}
          className="muted"
        >
          Rejection reason (optional)
        </label>
        <textarea
          id={`reason-${booking.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why the booking is rejected, if applicable"
          rows={2}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <label
          htmlFor={`alt-${booking.id}`}
          style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}
          className="muted"
        >
          Suggested alternative (optional)
        </label>
        <input
          id={`alt-${booking.id}`}
          value={alternative}
          onChange={(e) => setAlternative(e.target.value)}
          placeholder="e.g. Orchid Room on the same date"
          style={{ width: '100%', marginBottom: 12 }}
        />
        <div className="actions">
          <button
            id={`approve-booking-${booking.id}`}
            className="btn"
            disabled={deciding}
            onClick={() => decide(true)}
          >
            {deciding ? 'Saving…' : 'Approve'}
          </button>
          <button
            id={`reject-booking-${booking.id}`}
            className="btn danger"
            disabled={deciding}
            onClick={() => decide(false)}
          >
            {deciding ? 'Saving…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SCRUM-18 AC7/AC8: read-only row in the decided bookings table.
 * Shows status, booking window, and (for rejected bookings) the reason and alternative.
 */
function BookingRow({ booking }) {
  const isRejected = booking.status === 'REJECTED';
  return (
    <tr>
      <td>{booking.event_name || `Event #${booking.event_id}`}</td>
      <td>{booking.venue_name || `Venue #${booking.venue_id}`}</td>
      <td><BookingStatusBadge status={booking.status} /></td>
      <td>
        {booking.start_at ? new Date(booking.start_at).toLocaleString() : '—'}
        {booking.end_at && ` – ${new Date(booking.end_at).toLocaleString()}`}
      </td>
      <td>
        {isRejected && booking.decision_reason && (
          <span style={{ color: '#b91c1c', fontSize: '0.85rem' }}>
            {booking.decision_reason}
          </span>
        )}
        {isRejected && booking.alternative_suggestion && (
          <span style={{ color: '#374151', fontSize: '0.85rem', display: 'block' }}>
            Alt: {booking.alternative_suggestion}
          </span>
        )}
        {!isRejected && <span className="muted">—</span>}
      </td>
    </tr>
  );
}

export default function Venues() {
  const { hasRole } = useAuth();
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [form, setForm] = useState({
    name: '',
    location: '',
    capacity: 50,
    facilities: '',
    accessibility: 'Wheelchair access',
    operatingHours: '',
    layouts: ['THEATRE'],
  });
  const [selectedId, setSelectedId] = useState(null);
  const [updateForm, setUpdateForm] = useState(emptyForm);
  const [newLayout, setNewLayout] = useState('');
  const [error, setError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [saveToast, setSaveToast] = useState('');
  const [conflictModalMsg, setConflictModalMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const updateCardRef = useRef(null);

  const [searchForm, setSearchForm] = useState(EMPTY_SEARCH);
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedVenue, setSelectedVenue] = useState(null);

  const isVenueStaff = hasRole(ROLES.VENUE_STAFF);
  const pendingBookings = bookings.filter((b) => b.status === 'PENDING');
  const decidedBookings = bookings.filter((b) => b.status !== 'PENDING');

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

  // SCUM-7 AC1: a new venue can support several room layouts, so each one is a toggle.
  function toggleNewVenueLayout(layout) {
    setForm((current) => ({
      ...current,
      layouts: current.layouts.includes(layout)
        ? current.layouts.filter((item) => item !== layout)
        : [...current.layouts, layout],
    }));
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
    setSelectedVenue(null);
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
    setSelectedVenue(null);
  }

  /**
   * SCRUM-18 AC3/AC4/AC5: Venue Staff decide a single pending booking.
   * Approving/rejecting one booking does NOT change the status of any other
   * booking on the same event (AC9 — each is decided independently).
   */
  async function handleDecide(bookingId, approve, reason, alternativeSuggestion) {
    try {
      await api(`/api/venues/bookings/${bookingId}/decision`, {
        method: 'POST',
        body: { approve, reason, alternativeSuggestion },
      });
      await reload();
    } catch (err) {
      if (err.code === 'BOOKING_CONFLICT' || err.status === 409) {
        setConflictModalMsg(err.message);
      }
      throw err;
    }
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
              <>
                {selectedVenue && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <h3>{selectedVenue.name}</h3>
                      <button className="btn ghost" type="button" onClick={() => setSelectedVenue(null)}>
                        Close
                      </button>
                    </div>
                    <p className="muted">{selectedVenue.location}</p>
                    <p>Capacity {selectedVenue.capacity}</p>
                    <p>Facilities: {selectedVenue.facilities || 'None listed'}</p>
                    <p>Accessibility: {selectedVenue.accessibility || 'None listed'}</p>
                    {selectedVenue.operatingHours && <p>Operating hours: {selectedVenue.operatingHours}</p>}
                    <p>
                      Setup time: {selectedVenue.setupMinutes} min · Turnaround time: {selectedVenue.teardownMinutes} min
                    </p>
                    {selectedVenue.layouts?.length > 0 && (
                      <div className="roles">
                        {selectedVenue.layouts.map((layout) => <span className="pill" key={layout}>{layout}</span>)}
                      </div>
                    )}
                  </div>
                )}
                <div className="cards">
                  {searchResults.map((venue) => (
                    <div className="card" key={venue.id}>
                      <h3>{venue.name}</h3>
                      <p className="muted">{venue.location}</p>
                      <p>Capacity {venue.capacity}</p>
                      <p>Facilities: {venue.facilities || 'None listed'}</p>
                      <p>Accessibility: {venue.accessibility || 'None listed'}</p>
                      {venue.layouts?.length > 0 && (
                        <div className="roles">
                          {venue.layouts.map((layout) => <span className="pill" key={layout}>{layout}</span>)}
                        </div>
                      )}
                      <button
                        className="btn ghost"
                        type="button"
                        style={{ marginTop: 8 }}
                        onClick={() => setSelectedVenue(venue)}
                      >
                        View details
                      </button>
                    </div>
                  ))}
                </div>
              </>
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
              <label>Venue name<input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Location<input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label>Capacity<input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: numberValue(e.target.value) })} /></label>
              <label>Operating hours<input placeholder="08:00 - 22:00" value={form.operatingHours} onChange={(e) => setForm({ ...form, operatingHours: e.target.value })} /></label>
            </div>
            <div className="stack">
              <label>Facilities<textarea value={form.facilities} onChange={(e) => setForm({ ...form, facilities: e.target.value })} /></label>
              <label>Accessibility<textarea value={form.accessibility} onChange={(e) => setForm({ ...form, accessibility: e.target.value })} /></label>
              <fieldset className="stack">
                <legend>Supported layouts</legend>
                {LAYOUTS.map((layout) => (
                  <label className="checkbox-field" key={layout}>
                    <input type="checkbox" checked={form.layouts.includes(layout)} onChange={() => toggleNewVenueLayout(layout)} />
                    {layout}
                  </label>
                ))}
              </fieldset>
              <button className="btn" onClick={async () => {
                try {
                  await api('/api/venues', { method: 'POST', body: form });
                  setForm({ ...form, name: '' });
                  await reload();
                } catch (err) {
                  setError(err.details?.map((detail) => `${detail.field}: ${detail.message}`).join(' ') || err.message);
                }
              }}
              >
                Save venue
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        SCRUM-18 AC1/AC2/AC3: Booking requests section.
        Venue Staff see pending requests as actionable cards (each with full details and
        independent approve/reject controls). Decided bookings appear in a table below.
        Non-staff (Coordinators, Organisers) see only the status table (AC7/AC8).
      */}
      <div className="card" style={{ marginTop: 18 }}>
        <h3>Booking requests</h3>
        {isVenueStaff && pendingBookings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ marginBottom: 10 }}>
              Pending approval
              <span
                style={{
                  marginLeft: 8,
                  background: '#fcd34d',
                  color: '#92400e',
                  borderRadius: 12,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '2px 9px',
                }}
              >
                {pendingBookings.length}
              </span>
            </h4>
            {pendingBookings.map((booking) => (
              <PendingBookingCard
                key={booking.id}
                booking={booking}
                onDecide={handleDecide}
              />
            ))}
          </div>
        )}

        {isVenueStaff && pendingBookings.length === 0 && (
          <p className="muted" style={{ marginBottom: 16 }}>No pending booking requests.</p>
        )}

        {/* Decided bookings table — Venue Staff see only decided ones; others see all */}
        {(isVenueStaff ? decidedBookings : bookings).length > 0 ? (
          <>
            {isVenueStaff && <h4 style={{ marginBottom: 10 }}>Decided bookings</h4>}
            <table className="table" id="bookings-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Status</th>
                  <th>Window</th>
                  <th>Decision / Reason</th>
                </tr>
              </thead>
              <tbody>
                {(isVenueStaff ? decidedBookings : bookings).map((booking) => (
                  <BookingRow key={booking.id} booking={booking} />
                ))}
              </tbody>
            </table>
          </>
        ) : (
          !isVenueStaff && <p className="muted">No bookings yet.</p>
        )}
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
                  <label>Capacity<input type="number" min="1" value={updateForm.capacity} onChange={(e) => setUpdateField('capacity', numberValue(e.target.value))} /></label>
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
      <ConflictModal
        isOpen={Boolean(conflictModalMsg)}
        onClose={() => setConflictModalMsg('')}
        message={conflictModalMsg}
      />
    </>
  );
}
