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
  // SCRUM-14-TC01
  it('passes when every compulsory field is filled in', () => {
    expect(findMissingSubmissionFields(completeDraft)).toEqual([]);
  });

  // SCRUM-14-TC02
  it('flags missing compulsory fields by name', () => {
    const missing = findMissingSubmissionFields({ ...completeDraft, purpose: '', venue_requirements: null });
    expect(missing.map((m) => m.field)).toEqual(expect.arrayContaining(['purpose', 'venueRequirements']));
  });

  // SCRUM-14-TC03
  it('treats zero or missing attendance as incomplete', () => {
    const missing = findMissingSubmissionFields({ ...completeDraft, expected_attendance: 0 });
    expect(missing.map((m) => m.field)).toContain('expectedAttendance');
  });

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
    // SCRUM-14-TC04 (originally PR #12, no Jira number on the PR itself - folded under SCRUM-14)
    it('rejects an end date before the start date (e.g. start 6 Oct, end 5 Oct)', async () => {
      await expect(service.createEvent(organiser, {
        name: 'Backwards event', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-05T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.insertOne).not.toHaveBeenCalled();
    });

    // SCRUM-14-TC05
    it('rejects a start date equal to the end date (zero duration)', async () => {
      await expect(service.createEvent(organiser, {
        name: 'Instant event', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.insertOne).not.toHaveBeenCalled();
    });

    // SCRUM-14-TC06
    it('allows a start date before the end date', async () => {
      await service.createEvent(organiser, {
        name: 'Valid event', startAt: '2026-10-05T10:00:00Z', endAt: '2026-10-06T10:00:00Z',
      });
      expect(db.insertOne).toHaveBeenCalled();
    });

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

    // SCRUM-14-TC19
    it('after submitting, the Organiser can view the request and see its Submitted status', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 99, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: 'DRAFT', ...completeDraft,
      }));
      await service.submitEvent(organiser, 99);

      db.fetchOne.mockImplementation(async () => ({
        id: 99, organiser_id: 1, organisation_id: 10, coordinator_id: null, status: 'SUBMITTED', ...completeDraft,
      }));
      const viewed = await service.getEvent(organiser, 99);
      expect(viewed.status).toBe('SUBMITTED');
    });

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

    // SCRUM-15-TC02
    it('allows creating a draft with no dates yet (SCUM-15: only name is required)', async () => {
      await service.createEvent(organiser, { name: 'Untitled draft' });
      expect(db.insertOne).toHaveBeenCalled();
    });

    // SCRUM-15-TC03
    it('allows creating a draft with only one of the two dates set', async () => {
      await service.createEvent(organiser, { name: 'Half-filled draft', startAt: '2026-10-05T10:00:00Z' });
      expect(db.insertOne).toHaveBeenCalled();
    });
  });

  describe('updateEvent', () => {
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

    // SCRUM-14-TC10
    it('allows a valid date change', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await service.updateEvent(organiser, 3, { startAt: '2026-10-05T12:00:00Z' });
      expect(db.updateById).toHaveBeenCalled();
    });

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
  const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

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

  // SCRUM-15-TC05
  it('a Coordinator can view a Draft event', async () => {
    db.fetchOne.mockImplementation(async () => ({
      id: 99, organiser_id: 1, organisation_id: 10, coordinator_id: null, status: 'DRAFT', name: 'Untitled draft',
    }));
    const visible = await service.getEvent(coordinator, 99);
    expect(visible.id).toBe(99);
  });
});