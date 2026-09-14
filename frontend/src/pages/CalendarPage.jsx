import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    api('/api/events').then((data) => setEvents(data.events || []));
  }, []);

  const cells = useMemo(() => buildCells(cursor, events), [cursor, events]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Event calendar</h1>
          <p>Single combined view for now. A per-venue calendar can be added later without changing the API.</p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setCursor(addMonths(cursor, -1))}>Prev</button>
          <strong>{cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</strong>
          <button className="btn ghost" onClick={() => setCursor(addMonths(cursor, 1))}>Next</button>
        </div>
      </div>
      <div className="calendar">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="muted">{day}</div>
        ))}
        {cells.map((cell) => (
          <div className="cal-cell" key={cell.key}>
            <span>{cell.date.getDate()}</span>
            {cell.events.map((event) => (
              <Link className="cal-event" key={event.id} to={`/app/events/${event.id}`}>
                {event.name}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function buildCells(cursor, events) {
  const start = new Date(cursor);
  const weekday = (start.getDay() + 6) % 7;
  const first = new Date(start);
  first.setDate(start.getDate() - weekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      date,
      events: events.filter((event) => event.startAt && event.startAt.slice(0, 10) === key),
    };
  });
}
