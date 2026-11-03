/*
 * Purpose: provide an inline date-and-time form for rescheduling a venue booking.
 * AC: SCRUM-62 AC1 and AC3 — submit new times and allow the booking to return to PENDING for review.
 * Inputs: bookingId for the accessible form name and an onSubmit(startAt, endAt) callback.
 * Output: two required datetime-local fields and a submit button. Failure: callback errors propagate to the parent handler.
 */
import { useState } from 'react';

export default function RescheduleBookingForm({ bookingId, onSubmit }) {
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const saved = await onSubmit(startAt, endAt);
    if (saved === false) return;
    setStartAt('');
    setEndAt('');
  }

  return (
    <form
      aria-label={`Reschedule booking ${bookingId}`}
      onSubmit={handleSubmit}
      style={{ marginTop: 8 }}
    >
      <label>
        New start
        <input
          type="datetime-local"
          value={startAt}
          onChange={(event) => setStartAt(event.target.value)}
          required
          aria-label="New start date and time"
        />
      </label>
      <label>
        New end
        <input
          type="datetime-local"
          value={endAt}
          onChange={(event) => setEndAt(event.target.value)}
          required
          aria-label="New end date and time"
        />
      </label>
      <button type="submit" className="btn ghost">
        Save new time
      </button>
    </form>
  );
}
