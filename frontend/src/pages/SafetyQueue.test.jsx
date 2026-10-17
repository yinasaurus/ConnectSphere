import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import SafetyQueue from './SafetyQueue';

jest.mock('../api', () => ({ api: jest.fn() }));

describe('SCRUM-55 Safety queue page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC:       SCRUM-55 AC1
   * Scenario: Safety Officer opens the queue with one awaiting event.
   * Setup:    GET /api/events/safety-queue returns Workshop.
   * Expected: The event name links to its safety-check page.
   * Type:     normal
   */
  it('lists awaiting events with a link to the safety check', async () => {
    api.mockResolvedValue({
      events: [{
        id: 3,
        name: 'Workshop',
        status: 'AWAITING_SAFETY_CHECK',
        startAt: '2026-11-20T10:00:00.000Z',
        expectedAttendance: 80,
      }],
    });
    render(
      <MemoryRouter initialEntries={['/app/events/safety-queue']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/app/events/safety-queue" element={<SafetyQueue />} />
        </Routes>
      </MemoryRouter>
    );
    const link = await screen.findByRole('link', { name: 'Workshop' });
    expect(link).toHaveAttribute('href', '/app/events/3/safety-check');
    expect(api).toHaveBeenCalledWith('/api/events/safety-queue');
  });
});
