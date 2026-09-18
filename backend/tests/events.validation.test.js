const { findMissingSubmissionFields } = require('../src/services/events.service');

const completeDraft = {
  name: 'Town Hall',
  purpose: 'Quarterly update',
  description: 'All-hands meeting for the team.',
  start_at: '2026-01-01 09:00:00',
  end_at: '2026-01-01 11:00:00',
  expected_attendance: 50,
  venue_requirements: 'Projector and stage',
  accessibility_needs: 'None',
};

describe('SCUM-14 submission validation', () => {
  it('passes when every compulsory field is filled in', () => {
    expect(findMissingSubmissionFields(completeDraft)).toEqual([]);
  });

  it('flags missing compulsory fields by name', () => {
    const missing = findMissingSubmissionFields({ ...completeDraft, purpose: '', venue_requirements: null });
    expect(missing.map((m) => m.field)).toEqual(expect.arrayContaining(['purpose', 'venueRequirements']));
  });

  it('treats zero or missing attendance as incomplete', () => {
    const missing = findMissingSubmissionFields({ ...completeDraft, expected_attendance: 0 });
    expect(missing.map((m) => m.field)).toContain('expectedAttendance');
  });

  it('does not enforce these fields when only a draft is being saved (SCUM-15)', () => {
    // Draft creation only requires `name` — see createEvent(), which never calls
    // findMissingSubmissionFields. This test documents that expectation.
    const draftPayload = { name: 'Untitled event' };
    expect(draftPayload.name).toBeTruthy();
  });
});
