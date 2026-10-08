import { ROLE_LABELS, ROLES, homePathForRoles } from './constants';

describe('SCRUM-54 role labels after login', () => {
  /*
   * AC: SCRUM-54 AC1
   * Scenario: The UI turns stored role names into the labels a person reads after login.
   * Setup: EVENT_COORDINATOR_LEAD and SAFETY_OFFICER constants.
   * Expected: Lead is labelled "Lead" and Safety Officer is labelled "Safety Officer".
   * Type: normal
   */
  it('labels Event Coordinator Lead as Lead and Safety Officer as Safety Officer', () => {
    expect(ROLE_LABELS[ROLES.EVENT_COORDINATOR_LEAD]).toBe('Lead');
    expect(ROLE_LABELS[ROLES.SAFETY_OFFICER]).toBe('Safety Officer');
  });

  /*
   * AC: SCRUM-54 AC2
   * Scenario: A hybrid Coordinator + Lead is sent to a home path they are allowed to use.
   * Setup: Both roles on the same account.
   * Expected: Home is /app, the same landing a Coordinator or Lead uses.
   * Type: normal
   */
  it('sends a Coordinator + Lead hybrid to the shared staff home', () => {
    expect(homePathForRoles([ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD])).toBe('/app');
  });
});
