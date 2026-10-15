import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistrationSettingsCard from './RegistrationSettingsCard';

/**
 * SCRUM-63: the assigned Coordinator's registration card.
 * The API owns the rules (backend/tests/registrations.enable.test.js); these tests check the
 * card sends the right request and shows the right form for the event's state.
 */
const confirmedEvent = {
  id: 3,
  status: 'CONFIRMED',
  registrationOpen: false,
  registrationOpensAt: null,
  registrationClosesAt: null,
  registrationCapacity: null,
};

const enabledEvent = {
  ...confirmedEvent,
  registrationOpen: true,
  registrationOpensAt: '2026-11-01T09:00:00.000Z',
  registrationClosesAt: '2026-11-08T09:00:00.000Z',
  registrationCapacity: 50,
};

describe('SCRUM-63 RegistrationSettingsCard', () => {
  /*
   * AC: SCRUM-63 AC2
   * Scenario: Registration is not enabled; the Coordinator fills in all three values.
   * Expected: POST to the enable route with ISO dates and the capacity typed.
   */
  it('US63-F01: sends the window and capacity to the enable route', async () => {
    const onRun = jest.fn();
    render(<RegistrationSettingsCard event={confirmedEvent} onRun={onRun} />);

    await userEvent.type(screen.getByLabelText('Registration opens'), '2026-11-01T09:00');
    await userEvent.type(screen.getByLabelText('Registration closes'), '2026-11-08T09:00');
    await userEvent.type(screen.getByLabelText('Maximum capacity'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Enable registration' }));

    expect(onRun).toHaveBeenCalledWith({
      path: '/api/events/3/registration/enable',
      method: 'POST',
      body: {
        opensAt: new Date('2026-11-01T09:00').toISOString(),
        closesAt: new Date('2026-11-08T09:00').toISOString(),
        capacity: '50',
      },
    });
  });

  /*
   * AC: SCRUM-63 AC2
   * Scenario: The Coordinator presses Enable with empty boxes.
   * Expected: empty values are sent so the API can reject them as missing.
   */
  it('US63-F02: sends empty values when nothing is filled in', async () => {
    const onRun = jest.fn();
    render(<RegistrationSettingsCard event={confirmedEvent} onRun={onRun} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable registration' }));

    expect(onRun.mock.calls[0][0].body).toEqual({ opensAt: '', closesAt: '', capacity: '' });
  });

  /*
   * AC: SCRUM-63 AC5, AC6
   * Scenario: Registration is enabled; the card shows the settings and only sends what changed.
   */
  it('US63-F03: shows the current settings once registration is enabled', () => {
    render(<RegistrationSettingsCard event={enabledEvent} onRun={jest.fn()} />);
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable registration' })).not.toBeInTheDocument();
  });

  it('US63-F04: sends only the new capacity when the close date is left empty', async () => {
    const onRun = jest.fn();
    render(<RegistrationSettingsCard event={enabledEvent} onRun={onRun} />);
    await userEvent.type(screen.getByLabelText('New maximum capacity'), '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save registration changes' }));

    expect(onRun).toHaveBeenCalledWith({
      path: '/api/events/3/registration',
      method: 'PATCH',
      body: { capacity: '60' },
    });
  });

  it('US63-F05: sends only the new close date when capacity is left empty', async () => {
    const onRun = jest.fn();
    render(<RegistrationSettingsCard event={enabledEvent} onRun={onRun} />);
    await userEvent.type(screen.getByLabelText('New close date and time (later only)'), '2026-11-10T09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save registration changes' }));

    expect(onRun.mock.calls[0][0].body).toEqual({
      closesAt: new Date('2026-11-10T09:00').toISOString(),
    });
  });
});
