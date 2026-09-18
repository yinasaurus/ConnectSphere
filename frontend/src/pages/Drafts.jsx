import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Drafts() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/events?status=DRAFT')
      .then((data) => setDrafts((data.events || []).filter((event) => event.organiserId === user.id)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user.id]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>My drafts</h1>
          <p>Incomplete event requests you have saved. Continue editing before submitting for review.</p>
        </div>
        <Link className="btn" to="/app/events/new">New request</Link>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="cards">
        {drafts.map((draft) => (
          <Link key={draft.id} to={`/app/events/${draft.id}/edit`} className="card" style={{ textDecoration: 'none' }}>
            <h3>{draft.name || 'Untitled event request'}</h3>
            <p className="muted">{draft.purpose || 'No purpose set yet'}</p>
            <p>Last saved {new Date(draft.updatedAt).toLocaleString()}</p>
          </Link>
        ))}
        {!loading && !drafts.length && <div className="card muted">No drafts yet. Start a new event request and save it as a draft.</div>}
      </div>
    </>
  );
}
