jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { findMissingSubmissionFields } = service;
const { ROLES } = require('../src/constants/roles');

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
  /*
  * AC:       SCRUM-14 (AC1/AC2: compulsory fields are defined, and validation passes when all are filled)
  * Scenario: A fully-populated draft is checked for missing compulsory fields.
  * Setup:    findMissingSubmissionFields() called with completeDraft (every compulsory field set).
  * Expected: Returns an empty array — no missing fields.
  * Type:     normal
  */
  // SCRUM-14-TC01
  it('passes when every compulsory field is filled in', () => {
    expect(findMissingSubmissionFields(completeDraft)).toEqual([]);
  });

  /*
   * AC:       SCRUM-14 (AC2: request cannot be submitted if compulsory fields are missing)
  * Scenario: A draft is missing purpose and venue requirements.
  * Setup:    findMissingSubmissionFields() called with purpose='' and venue_requirements=null.
  * Expected: Returned list includes 'purpose' and 'venueRequirements'.
  * Type:     error
  */ 
  // SCRUM-14-TC02
  it('flags missing compulsory fields by name', () => {
    const missing = findMissingSubmissionFields({ ...completeDraft, purpose: '', venue_requirements: null });
    expect(missing.map((m) => m.field)).toEqual(expect.arrayContaining(['purpose', 'venueRequirements']));
  });

  /*
  * AC:       SCRUM-14 (AC2: request cannot be submitted if expected attendance is missing)
  * Scenario: A draft has expected_attendance set to 0.
  * Setup:    findMissingSubmissionFields() called with expected_attendance=0.
  * Expected: Returned list includes 'expectedAttendance' — zero counts as missing, not a valid value.
  * Type:     boundary
  */
  // SCRUM-14-TC03
  it('treats zero or missing attendance as incomplete', () => {
    const missing = findMissingSubmissionFields({ ...completeDraft, expected_attendance: 0 });
    expect(missing.map((m) => m.field)).toContain('expectedAttendance');
  });

  /*
  * AC:       SCRUM-14 (AC2: request cannot be submitted if name, date/time or attendance is missing)
  * Scenario: A compulsory-fields check is run against a draft missing just the name, then again missing both dates.
  * Setup:    findMissingSubmissionFields() called with name='' in one case, start_at/end_at=null in the other.
  * Expected: 'name' is flagged in the first case; 'startAt' and 'endAt' are both flagged in the second.
  * Type:     error
  */
  // SCRUM-14-TC18
  it('flags a missing name and missing start/end date', () => {
    const missingName = findMissingSubmissionFields({ ...completeDraft, name: '' });
    expect(missingName.map((m) => m.field)).toContain('name');

    const missingDates = findMissingSubmissionFields({ ...completeDraft, start_at: null, end_at: null });
    expect(missingDates.map((m) => m.field)).toEqual(expect.arrayContaining(['startAt', 'endAt']));
  });
});

// Bug fix: event creation/editing never checked that start comes before end
// (e.g. "starts 6 Oct, ends 5 Oct" was previously accepted).
describe('event start/end date range validation', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([]);
    db.fetchOne.mockImplementation(async () => ({ id: 99, organiser_id: 1, organisation_id: 10, status: 'DRAFT', name: 'Event' }));
    db.insertOne.mockImplementation(async () => ({ id: 99 }));
    db.updateById.mockImplementation(async () => ({ id: 99 }));
  });

  describe('createEvent', () => {
    /*
    * AC:       SCRUM-14 (regression — not tied to a numbered AC)
    * Scenario: Creating an event with an end date before its start date.
    * Setup:    createEvent() called with startAt='2026-10-06T10:00:00Z', endAt='2026-10-05T10:00:00Z'.
    * Expected: Rejected with 400 VALIDATION_ERROR; insertOne is never called.
    * Type:     error
    */
    // SCRUM-14-TC04
    it('rejects an end date before the start date (e.g. start 6 Oct, end 5 Oct)', async () => {
      await expect(service.createEvent(organiser, {
        name: 'Backwards event', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-05T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.insertOne).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (regression — not tied to a numbered AC)
    * Scenario: Creating an event where start and end are the same instant.
    * Setup:    createEvent() called with startAt and endAt both '2026-10-06T10:00:00Z'.
    * Expected: Rejected with 400 VALIDATION_ERROR; insertOne is never called.
    * Type:     boundary
    */
    // SCRUM-14-TC05
    it('rejects a start date equal to the end date (zero duration)', async () => {
      await expect(service.createEvent(organiser, {
        name: 'Instant event', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.insertOne).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (regression — not tied to a numbered AC)
    * Scenario: Creating an event with a valid start/end range.
    * Setup:    createEvent() called with startAt='2026-10-05T10:00:00Z', endAt='2026-10-06T10:00:00Z'.
    * Expected: Event is created (insertOne is called).
    * Type:     normal
    */
    // SCRUM-14-TC06
    it('allows a start date before the end date', async () => {
      await service.createEvent(organiser, {
        name: 'Valid event', startAt: '2026-10-05T10:00:00Z', endAt: '2026-10-06T10:00:00Z',
      });
      expect(db.insertOne).toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (AC1: Organiser can enter equipment requirements and registration needs)
    * Scenario: An Organiser creates an event with equipment and registration details filled in.
    * Setup:    createEvent() called with equipmentNotes, registrationRequired and registrationCapacity set.
    * Expected: patch.equipment_notes, patch.registration_required and patch.registration_capacity all match what was entered.
    * Type:     normal
    */
    // SCRUM-14-TC17
    it('persists equipment and registration fields entered at creation', async () => {
      await service.createEvent(organiser, {
        name: 'Workshop with extras',
        equipmentNotes: '2 projectors, 4 mics',
        registrationRequired: true,
        registrationCapacity: 80,
      });

      expect(db.insertOne).toHaveBeenCalled();
      const [, patch] = db.insertOne.mock.calls[0];
      expect(patch.equipment_notes).toBe('2 projectors, 4 mics');
      expect(patch.registration_required).toBe(true);
      expect(patch.registration_capacity).toBe(80);
    });

    /*
    * AC:       SCRUM-15 (AC1: Organiser can save a partially completed event request without filling in every field)
    * Scenario: A draft is created with only a name.
    * Setup:    createEvent() called with { name: 'Untitled event' } — no purpose, description, venue requirements, accessibility needs or attendance.
    * Expected: insertOne is called; patch.purpose, patch.description, patch.venue_requirements, patch.accessibility_needs and patch.expected_attendance are all null — none required, none defaulted.
    * Type:     normal
    */
    // SCRUM-15-TC01
    it('does not enforce compulsory submission fields when only a draft is being saved', async () => {
      await service.createEvent(organiser, { name: 'Untitled event' });

      expect(db.insertOne).toHaveBeenCalled();
      const [, patch] = db.insertOne.mock.calls[0];
      expect(patch.purpose).toBeNull();
      expect(patch.description).toBeNull();
      expect(patch.venue_requirements).toBeNull();
      expect(patch.accessibility_needs).toBeNull();
      expect(patch.expected_attendance).toBeNull();
    });

    /*
    * AC:       SCRUM-15 (AC1: Organiser can save a partially completed event request without filling in every field)
    * Scenario: A draft is created with no dates at all.
    * Setup:    createEvent() called with { name: 'Untitled draft' } only (no startAt/endAt).
    * Expected: Event is created successfully (insertOne is called) — date-range validation is skipped when both dates are absent.
    * Type:     boundary
    */
    // SCRUM-15-TC02
    it('allows creating a draft with no dates yet (SCUM-15: only name is required)', async () => {
      await service.createEvent(organiser, { name: 'Untitled draft' });
      expect(db.insertOne).toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-15 (AC1: Organiser can save a partially completed event request without filling in every field)
    * Scenario: A draft is created with only one of the two dates set.
    * Setup:    createEvent() called with { name: 'Half-filled draft', startAt: '2026-10-05T10:00:00Z' }.
    * Expected: Event is created successfully (insertOne is called) — date-range validation is skipped when either date is absent.
    * Type:     boundary
    */
    // SCRUM-15-TC03
    it('allows creating a draft with only one of the two dates set', async () => {
      await service.createEvent(organiser, { name: 'Half-filled draft', startAt: '2026-10-05T10:00:00Z' });
      expect(db.insertOne).toHaveBeenCalled();
    });
  });

  describe('updateEvent', () => {
    /*
    * AC:       SCRUM-14 (regression — date-range validation also applies on edit)
    * Scenario: An existing event's start date is moved past its own end date.
    * Setup:    Existing event has start_at/end_at 2026-10-01/06; updateEvent() patches startAt to 2026-10-07.
    * Expected: Rejected with 400 VALIDATION_ERROR; updateById is never called.
    * Type:     error
    */
    // SCRUM-14-TC07
    it('rejects moving the start date past the existing end date', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await expect(service.updateEvent(organiser, 3, { startAt: '2026-10-07T10:00:00Z' }))
        .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (regression — date-range validation also applies on edit)
    * Scenario: An existing event's end date is moved before its own start date.
    * Setup:    Existing event has start_at/end_at 2026-10-05/06; updateEvent() patches endAt to 2026-10-04.
    * Expected: Rejected with 400 VALIDATION_ERROR; updateById is never called.
    * Type:     error
    */
    // SCRUM-14-TC08
    it('rejects moving the end date before the existing start date', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await expect(service.updateEvent(organiser, 3, { endAt: '2026-10-04T10:00:00Z' }))
        .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (regression — date-range validation also applies on edit)
    * Scenario: Both dates are changed together into an invalid combination.
    * Setup:    updateEvent() patches startAt to 2026-10-10 and endAt to 2026-10-09 in the same call.
    * Expected: Rejected with 400 VALIDATION_ERROR; updateById is never called.
    * Type:     error
    */
    // SCRUM-14-TC09
    it('rejects an invalid combination when both dates change in one patch', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await expect(service.updateEvent(organiser, 3, {
        startAt: '2026-10-10T10:00:00Z', endAt: '2026-10-09T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (regression — date-range validation also applies on edit)
    * Scenario: A valid date change is made to an existing event.
    * Setup:    updateEvent() patches startAt to 2026-10-05T12:00:00Z, still before the existing end date.
    * Expected: Update succeeds (updateById is called).
    * Type:     normal
    */
    // SCRUM-14-TC10
    it('allows a valid date change', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await service.updateEvent(organiser, 3, { startAt: '2026-10-05T12:00:00Z' });
      expect(db.updateById).toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-14 (regression — date validation must not block unrelated edits)
    * Scenario: An edit that doesn't touch either date is made to an existing event.
    * Setup:    updateEvent() patches only { description: 'New description' }.
    * Expected: Update succeeds (updateById is called) — date-range validation never runs when dates are untouched.
    * Type:     normal
    */
    // SCRUM-14-TC11
    it('leaves unrelated edits unaffected when dates are untouched', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await service.updateEvent(organiser, 3, { description: 'New description' });
      expect(db.updateById).toHaveBeenCalled();
    });
  });
});

// Regression guard for the actual bug SCUM-14/15 fixed (PR #1): start_at/end_at were
// once passed to insertOne as raw strings, which caused MySQL/Supabase datetime insert
// errors. toSqlDateTime() converts them to real Date objects first - this was never
// directly asserted anywhere until now.
describe('SCUM-14/15 regression: dates are converted to real Date objects before insert', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([]);
    db.fetchOne.mockImplementation(async () => ({ id: 99, organiser_id: 1, organisation_id: 10, status: 'DRAFT', name: 'Event' }));
    db.insertOne.mockImplementation(async () => ({ id: 99 }));
  });

  /*
  * AC:       SCRUM-14/15 (regression — the toSqlDateTime() MySQL/Supabase datetime-insert fix had no prior test)
  * Scenario: An event is created with both dates set.
  * Setup:    createEvent() called with startAt='2026-10-05T10:00:00Z', endAt='2026-10-06T10:00:00Z'.
  * Expected: patch.start_at and patch.end_at are real Date instances, not raw strings.
  * Type:     normal
  */
  // SCRUM-14-TC12
  it('passes start_at/end_at to insertOne as real Date instances, not raw strings', async () => {
    await service.createEvent(organiser, {
      name: 'Date conversion check',
      startAt: '2026-10-05T10:00:00Z',
      endAt: '2026-10-06T10:00:00Z',
    });

    const [, patch] = db.insertOne.mock.calls[0];
    expect(patch.start_at).toBeInstanceOf(Date);
    expect(patch.end_at).toBeInstanceOf(Date);
  });

  /*
  * AC:       SCRUM-14/15 (regression — same datetime-insert fix, draft case)
  * Scenario: A draft is created with no dates at all.
  * Setup:    createEvent() called with only { name: 'No dates yet' }.
  * Expected: patch.start_at and patch.end_at are both null, not an invalid value.
  * Type:     boundary
  */
  // SCRUM-14-TC13
  it('passes null through for start_at/end_at when no date is given (SCUM-15 draft), not an invalid value', async () => {
    await service.createEvent(organiser, { name: 'No dates yet' });

    const [, patch] = db.insertOne.mock.calls[0];
    expect(patch.start_at).toBeNull();
    expect(patch.end_at).toBeNull();
  });
});

describe('SCRUM-15 draft lifecycle', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([]);
  });

  /*
  * AC:       SCRUM-15 (AC3: Organiser can continue editing and later submit the draft as a complete request)
  * Scenario: A draft created with just a name is completed via edits, then submitted.
  * Setup:    createEvent() with only a name; updateEvent() fills in every remaining compulsory field; submitEvent() is then called.
  * Expected: submitEvent() succeeds; updateById is called with status SUBMITTED.
  * Type:     normal
  */
  // SCRUM-15-TC04
  it('a draft completed via edits submits successfully', async () => {
    db.insertOne.mockImplementation(async () => ({ id: 99, status: 'DRAFT' }));
    await service.createEvent(organiser, { name: 'Untitled draft' });

    db.fetchOne.mockImplementation(async () => ({
      id: 99, organiser_id: 1, organisation_id: 10, status: 'DRAFT', name: 'Untitled draft',
    }));
    db.updateById.mockImplementation(async () => ({ id: 99 }));
    await service.updateEvent(organiser, 99, { ...completeDraft, name: 'Untitled draft' });

    db.fetchOne.mockImplementation(async () => ({
      id: 99, organiser_id: 1, organisation_id: 10, status: 'DRAFT', ...completeDraft,
    }));
    await service.submitEvent(organiser, 99);
    expect(db.updateById).toHaveBeenCalledWith('events', 99, expect.objectContaining({ status: 'SUBMITTED' }));
  });
});