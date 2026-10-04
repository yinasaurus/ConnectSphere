import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { LAYOUTS, ROLES } from '../constants';

const EMPTY_SEARCH = {
  startAt: '',
  endAt: '',
  capacityMin: '',
  location: '',
  accessibility: '',
  layout: '',
  facilities: '',
};

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
  const [error, setError] = useState('');

  const [searchForm, setSearchForm] = useState(EMPTY_SEARCH);
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedVenue, setSelectedVenue] = useState(null);

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

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Venues</h1>
          <p>Catalogue, layouts, and booking queue. Conflict checks include setup and turnaround time.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}

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

      {hasRole(ROLES.VENUE_STAFF) && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>Add venue</h3>
          <div className="grid-2">
            <div className="stack">
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
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
    </>
  );
}
