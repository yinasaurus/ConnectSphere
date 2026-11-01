import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendeeRegistrationCard from '../../src/components/AttendeeRegistrationCard';

/**
 * SCRUM-51: what the Attendee's Registration card shows for each registration state and
 * their own status. The rules are checked by the API (backend/tests/registrations.status.test.js).
 */
const OPENS = '2026-11-01T09:00:00.000Z';
const CLOSES = '2026-11-08T09:00:00.000Z';

function status(overrides = {}) {
  return {
    state: 'OPEN',
    opensAt: OPENS,
    closesAt: CLOSES,
    capacity: 50,
    placesLeft: 40,
    myRegistration: null,
    ...overrides,
  };
}

function renderCard(s) {
  const onRegister = jest.fn();
  const onWithdraw = jest.fn();
  render(<AttendeeRegistrationCard status={s} onRegister={onRegister} onWithdraw={onWithdraw} />);
  return { onRegister, onWithdraw };
}

describe('SCRUM-51 AttendeeRegistrationCard', () => {
  /*
   * AC: SCRUM-51 AC1, AC2
   * Scenario: Registration is open and the Attendee has not registered.
   * Expected: open message, window, places left, "Not registered", and a Register button that works.
   */
  it('US51-F01: shows an open event and lets a new Attendee register', async () => {
    const { onRegister } = renderCard(status());

    expect(screen.getByText('Registration is open.')).toBeInTheDocument();
    expect(screen.getByText(new Date(OPENS).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(new Date(CLOSES).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('40 of 50')).toBeInTheDocument();
    expect(screen.getByText('Not registered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-51 AC2
   * Scenario: The Attendee is registered.
   * Expected: "Registered on <date>", a Withdraw button, and no Register button.
   */
  it('US51-F02: shows a registered Attendee their status and a Withdraw button', async () => {
    const registeredAt = '2026-11-02T10:00:00.000Z';
    const { onWithdraw } = renderCard(status({ myRegistration: { status: 'REGISTERED', registeredAt, withdrawnAt: null } }));

    expect(screen.getByText(`Registered on ${new Date(registeredAt).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-51 AC2
   * Scenario: The Attendee withdrew and registration is still open.
   * Expected: "Withdrawn on <date>" and they can register again.
   */
  it('US51-F03: shows a withdrawn Attendee when they withdrew and lets them register again', () => {
    const withdrawnAt = '2026-11-03T10:00:00.000Z';
    renderCard(status({ myRegistration: { status: 'WITHDRAWN', registeredAt: OPENS, withdrawnAt } }));

    expect(screen.getByText(`Withdrawn on ${new Date(withdrawnAt).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
  });

  it.each([
    ['ATTENDED', 'Attended'],
    ['NO_SHOW', 'Did not attend'],
    ['WAITLISTED', 'Waitlisted'],
    ['SOMETHING_NEW', 'SOMETHING_NEW'],
    ['WITHDRAWN', 'Withdrawn'],
  ])('US51-F04: shows the status %s as "%s"', (code, text) => {
    renderCard(status({ state: 'CLOSED', myRegistration: { status: code, registeredAt: OPENS, withdrawnAt: null } }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-51 AC1
   * Scenario: Each state where the Attendee cannot register.
   * Expected: the reason is shown and there is no Register button.
   */
  it.each([
    ['NOT_YET_OPEN', `Registration opens on ${new Date(OPENS).toLocaleString()}.`],
    ['CLOSED', `Registration closed on ${new Date(CLOSES).toLocaleString()}.`],
    ['FULL', 'This event is full.'],
    ['STARTED', 'This event has already started, so registration is closed.'],
  ])('US51-F05: when registration is %s it explains why and hides Register', (state, text) => {
    renderCard(status({ state, placesLeft: state === 'FULL' ? 0 : 40 }));
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
  });

  it('US51-F06: before registration is enabled it shows no window or places', () => {
    renderCard(status({ state: 'NOT_OPEN', opensAt: null, closesAt: null, capacity: null, placesLeft: null }));
    expect(screen.getByText('Registration is not open for this event.')).toBeInTheDocument();
    expect(screen.queryByText('Places left:')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-52 AC5
   * Scenario: A Register request is already running.
   * Expected: the button reads "Registering..." and is disabled, so it cannot be pressed twice.
   */
  it('US51-F10: the Register button is disabled while registering', () => {
    render(<AttendeeRegistrationCard status={status()} registering onRegister={jest.fn()} onWithdraw={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Registering...' })).toBeDisabled();
  });

  it('US51-F07: says so when the registration details cannot be loaded', () => {
    renderCard(null);
    expect(screen.getByText('Registration details are not available right now.')).toBeInTheDocument();
  });
});
