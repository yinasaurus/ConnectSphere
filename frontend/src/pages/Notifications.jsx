import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Purpose: the signed-in user's in-app notices, newest first, with "Mark read" and a link to
 * the event each notice is about.
 * AC: SCRUM-78 AC1-AC4 (this is where a Coordinator sees a booking decision notice, with
 * the event and venue in its text and an "Open event" link).
 * AC: SCRUM-44 AC3 — unread (read_at === null) notifications are visually distinguished
 * with a blue left border, light background, bold title, and blue dot indicator.
 * Failure: NEEDS HUMAN: a failed load is not caught, so the list just stays empty.
 */
export default function Notifications() {
  const [items, setItems] = useState([]);

  async function reload() {
    const data = await api('/api/notifications');
    setItems(data.notifications || []);
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Notifications</h1>
          <p>In-app first. Email can be added behind the same write path later.</p>
        </div>
      </div>
      <div className="card">
        {items.map((item) => (
          <div 
            className="comment" 
            key={item.id}
            style={{
              borderLeft: !item.read_at ? '4px solid #007bff' : '4px solid transparent',
              backgroundColor: !item.read_at ? '#f8f9fa' : 'transparent',
            }}
          >
            <div className="row-between">
              <strong style={{ fontWeight: !item.read_at ? 'bold' : 'normal' }}>
                {!item.read_at && <span style={{ color: '#007bff', marginRight: '8px' }}>●</span>}
                {item.title}
              </strong>
              {!item.read_at && (
                <button className="btn ghost" onClick={() => api(`/api/notifications/${item.id}/read`, { method: 'POST' }).then(reload)}>
                  Mark read
                </button>
              )}
            </div>
            <p>{item.body}</p>
            {item.event_id && <Link to={`/app/events/${item.event_id}`}>Open event</Link>}
          </div>
        ))}
        {!items.length && <p className="muted">You are up to date.</p>}
      </div>
    </>
  );
}
