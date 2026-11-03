import { formatDate, formatDateTime, formatMonth, formatTime, singaporeDateKey } from '../src/formatDateTime';

describe('Singapore date format', () => {
  const utc = '2026-11-03T02:00:00.000Z';

  /*
   * AC: SCRUM-92
   * Scenario: A stored UTC time is shown on screen.
   * Setup: The instant is 2026-11-03T02:00:00.000Z.
   * Expected: It reads 3 Nov 2026, 10:00. The date alone is 3 Nov 2026. The time alone is 10:00.
   * Type: normal
   */
  // SCRUM-92-TC09
  it('shows the same Singapore date and time everywhere', () => {
    expect(formatDateTime(utc)).toBe('3 Nov 2026, 10:00');
    expect(formatDate(utc)).toBe('3 Nov 2026');
    expect(formatTime(utc)).toBe('10:00');
    expect(formatMonth(utc)).toBe('November 2026');
    expect(singaporeDateKey(utc)).toBe('2026-11-03');
  });
});
