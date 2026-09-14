import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { LAYOUTS, ROLES } from '../constants';

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

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Venues</h1>
          <p>Catalogue, layouts, and booking queue. Conflict checks include setup and turnaround time.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
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
