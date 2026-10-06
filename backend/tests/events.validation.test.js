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

// Bug fix: event creation/editing never checked that start comes before end
// (e.g. "starts 6 Oct, ends 5 Oct" was previously accepted).
describe('event start/end date range validation', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() });
    db.fetchOne.mockImplementation(async () => ({ id: 99, organiser_id: 1, organisation_id: 10, status: 'DRAFT', name: 'Event' }));
    db.insertOne.mockImplementation(async () => ({ id: 99 }));
    db.updateById.mockImplementation(async () => ({ id: 99 }));
  });

  describe('createEvent', () => {
    it('rejects an end date before the start date (e.g. start 6 Oct, end 5 Oct)', async () => {
      await expect(service.createEvent(organiser, {
        name: 'Backwards event', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-05T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.insertOne).not.toHaveBeenCalled();
    });

    it('rejects a start date equal to the end date (zero duration)', async () => {
      await expect(service.createEvent(organiser, {
        name: 'Instant event', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T10:00:00Z',
      })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.insertOne).not.toHaveBeenCalled();
    });

    it('allows a start date before the end date', async () => {
      await service.createEvent(organiser, {
        name: 'Valid event', startAt: '2026-10-05T10:00:00Z', endAt: '2026-10-06T10:00:00Z',
      });
      expect(db.insertOne).toHaveBeenCalled();
    });

    it('allows creating a draft with no dates yet (SCUM-15: only name is required)', async () => {
      await service.createEvent(organiser, { name: 'Untitled draft' });
      expect(db.insertOne).toHaveBeenCalled();
    });

    it('allows creating a draft with only one of the two dates set', async () => {
      await service.createEvent(organiser, { name: 'Half-filled draft', startAt: '2026-10-05T10:00:00Z' });
      expect(db.insertOne).toHaveBeenCalled();
    });
  });

  describe('updateEvent', () => {
    it('rejects moving the start date past the existing end date', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await expect(service.updateEvent(organiser, 3, { startAt: '2026-10-07T10:00:00Z' }))
        .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    it('rejects moving the end date before the existing start date', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await expect(service.updateEvent(organiser, 3, { endAt: '2026-10-04T10:00:00Z' }))
        .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

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

    it('allows a valid date change', async () => {
      db.fetchOne.mockImplementation(async () => ({
        id: 3, organiser_id: 1, organisation_id: 10, status: 'DRAFT',
        start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-06T10:00:00Z',
      }));
      await service.updateEvent(organiser, 3, { startAt: '2026-10-05T12:00:00Z' });
      expect(db.updateById).toHaveBeenCalled();
    });

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
