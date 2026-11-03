import { formatDate, formatDateTime, formatMonth, formatTime, singaporeDateKey } from '../src/formatDateTime';

describe('Singapore date format', () => {
  const utc = '2026-11-03T02:00:00.000Z';

  it('shows the same Singapore date and time everywhere', () => {
    expect(formatDateTime(utc)).toBe('3 Nov 2026, 10:00');
    expect(formatDate(utc)).toBe('3 Nov 2026');
    expect(formatTime(utc)).toBe('10:00');
    expect(formatMonth(utc)).toBe('November 2026');
    expect(singaporeDateKey(utc)).toBe('2026-11-03');
  });
});
