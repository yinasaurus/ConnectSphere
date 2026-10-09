import { ROLES, homePathForRoles } from './constants';

describe('homePathForRoles', () => {
  /*
   * AC: SCRUM-65 AC1
   * Scenario: The Event Coordinator Lead signs in.
   * Expected: They land on the unassigned queue so they can see new Submitted requests.
   */
  it('sends the Lead to the unassigned queue', () => {
    expect(homePathForRoles([ROLES.EVENT_COORDINATOR_LEAD])).toBe('/app/events/unassigned');
  });

  it('sends a Coordinator to the dashboard', () => {
    expect(homePathForRoles([ROLES.EVENT_COORDINATOR])).toBe('/app');
  });

  it('still sends the Lead to the queue when they also have Coordinator', () => {
    expect(homePathForRoles([ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD])).toBe(
      '/app/events/unassigned'
    );
  });

  it('sends a Safety Officer to the dashboard', () => {
    expect(homePathForRoles([ROLES.SAFETY_OFFICER])).toBe('/app');
  });
});
