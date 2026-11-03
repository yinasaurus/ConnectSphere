import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Button from '../components/Button';
import { formatMonth, singaporeDateKey } from '../formatDateTime';

const VISIBLE_EVENTS = 3;

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [openDay, setOpenDay] = useState(null);
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
          <p className="single-line">Single combined view for now. A per-venue calendar can be added later without changing the API.</p>
        </div>
        <div className="actions">
          <Button variant="ghost"  onClick={() => setCursor(addMonths(cursor, -1))}>Prev</Button>
          <strong>{formatMonth(cursor)}</strong>
          <Button variant="ghost"  onClick={() => setCursor(addMonths(cursor, 1))}>Next</Button>
        </div>
      </div>
      <div className="calendar">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="cal-head">{day}</div>
        ))}
        {cells.map((cell) => {
          const expanded = openDay === cell.key;
          const visible = expanded ? cell.events : cell.events.slice(0, VISIBLE_EVENTS);
          const hidden = cell.events.length - visible.length;
          return (
            <div
              className={`cal-cell${cell.inMonth ? '' : ' cal-outside'}${cell.isToday ? ' cal-today' : ''}`}
              key={cell.key}
            >
              <span className="cal-day">{cell.date.getDate()}</span>
              {visible.map((event) => (
                <Link className="cal-event" key={event.id} to={`/app/events/${event.id}`} title={event.name}>
                  {event.name}
                </Link>
              ))}
              {hidden > 0 && (
                <button type="button" className="cal-more" onClick={() => setOpenDay(cell.key)}>
                  +{hidden} more
                </button>
              )}
            </div>
          );
        })}
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
    const key = singaporeDateKey(date);
    return {
      key,
      date,
      inMonth: date.getMonth() === cursor.getMonth(),
      isToday: key === singaporeDateKey(new Date()),
      events: events.filter((event) => singaporeDateKey(event.startAt) === key),
    };
  });
}
