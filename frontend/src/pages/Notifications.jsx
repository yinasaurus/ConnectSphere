import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

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
          <div className="comment" key={item.id}>
            <div className="row-between">
              <strong>{item.title}</strong>
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
