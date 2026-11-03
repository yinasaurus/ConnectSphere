/**
 * SCRUM-92: the calendar shows each event on its Singapore day, one name per line.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CalendarPage from '../../src/pages/CalendarPage';
import { api } from '../../src/api';

jest.mock('../../src/api', () => ({ api: jest.fn() }));

const LONG_NAME = 'Clarification Test with a very long name';
const events = [
  { id: 1, name: 'Midnight hold', startAt: '2026-11-15T16:30:00.000Z' },
  { id: 2, name: 'Morning one', startAt: '2026-11-16T01:00:00.000Z' },
  { id: 3, name: 'Morning two', startAt: '2026-11-16T02:00:00.000Z' },
  { id: 4, name: LONG_NAME, startAt: '2026-11-16T03:00:00.000Z' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dayCell(day) {
  return [...document.querySelectorAll('.cal-cell')].find(
    (cell) => cell.querySelector('.cal-day')?.textContent === String(day),
  );
}

async function openNovember2026(user) {
  for (let step = 0; step < 36; step += 1) {
    const [monthName, yearText] = document.querySelector('.topbar strong').textContent.split(' ');
    const year = Number(yearText);
    const month = MONTHS.indexOf(monthName);
    if (year === 2026 && month === 10) return;
    const later = year > 2026 || (year === 2026 && month > 10);
    await user.click(screen.getByRole('button', { name: later ? 'Prev' : 'Next' }));
  }
  throw new Error('November 2026 was not reached');
}

describe('SCRUM-92 event calendar', () => {
  /*
   * AC: SCRUM-92
   * Scenario: The calendar has several events on one Singapore day, including one just after midnight.
   * Setup: One event starts at 2026-11-15T16:30:00.000Z, which is 16 Nov 2026, 00:30 in Singapore.
   *   Three more events start later that same Singapore day. One of the names is longer than the day cell.
   * Expected: All four sit on 16 Nov, not 15 Nov. Each name stays on one line. The day shows three names and +1 more.
   * Type: boundary
   */
  // SCRUM-92-TC10
  it('puts a just-after-midnight event on the Singapore day and keeps names on one line', async () => {
    api.mockResolvedValue({ events });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Event calendar' });
    await openNovember2026(user);

    const sixteenth = dayCell(16);
    expect(sixteenth).toHaveTextContent('Midnight hold');
    expect(sixteenth).toHaveTextContent('Morning one');
    expect(sixteenth).toHaveTextContent('Morning two');
    expect(sixteenth).toHaveTextContent('+1 more');
    expect(sixteenth).not.toHaveTextContent(LONG_NAME);
    expect(dayCell(15)).not.toHaveTextContent('Midnight hold');

    const shown = screen.getByRole('link', { name: 'Midnight hold' });
    expect(shown).toHaveClass('cal-event');
    expect(shown).toHaveAttribute('title', 'Midnight hold');

    await user.click(screen.getByRole('button', { name: '+1 more' }));
    expect(screen.getByRole('link', { name: LONG_NAME })).toHaveAttribute('title', LONG_NAME);
  });
});
