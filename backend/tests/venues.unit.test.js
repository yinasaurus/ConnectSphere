jest.mock('../src/config/db', () => ({
  supabase: {
    from: jest.fn(),
  },
  fetchMany: jest.fn(),
  fetchOne: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
  throwIf: jest.fn((error) => {
    if (error) throw error;
  }),
}));

jest.mock('../src/middleware/auth', () => ({
  hasRole: jest.fn(() => true),
}));

jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const { hasRole } = require('../src/middleware/auth');
const audit = require('../src/services/audit.service');
const { createVenueSchema, updateVenueSchema } = require('../src/validators/venues.validators');
const { createVenue, updateVenue } = require('../src/services/venues.service');

describe('venue catalogue unit behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * AC:       SCUM-7 AC4 (incomplete entries, e.g. missing capacity)
   * Scenario: Venue Staff submit a new venue with no capacity, a non-number, or 0.
   * Setup:    createVenueSchema only, as run by the POST /api/venues route.
   * Expected: Each is rejected with a clear message, so an incomplete venue never reaches
   *           the database. 0 counts as incomplete (team decision: at least 1).
   * Type:     error
   */
  it('requires a capacity of at least 1 when creating a venue', () => {
    const issue = (body) => createVenueSchema.safeParse(body).error.issues[0].message;
    expect(issue({ name: 'Studio' })).toBe('Capacity is required');
    expect(issue({ name: 'Studio', capacity: '' })).toBe('Capacity must be a number');
    expect(issue({ name: 'Studio', capacity: 0 })).toBe('Capacity must be at least 1');
    expect(issue({ name: 'Studio', capacity: 2.5 })).toBe('Capacity must be a whole number');
  });

  /*
   * AC:       SCUM-7 AC4 (duplicate entries)
   * Scenario: A new venue lists the same layout twice.
   * Setup:    createVenueSchema with layouts ['THEATRE', 'THEATRE', 'BANQUET'].
   * Expected: The repeat is removed, so the venue doesn't end up with duplicate layouts.
   * Type:     boundary
   */
  it('removes repeated layouts from a new venue', () => {
    expect(createVenueSchema.parse({ name: 'Studio', capacity: 5, layouts: ['THEATRE', 'THEATRE', 'BANQUET'] }).layouts)
      .toEqual(['THEATRE', 'BANQUET']);
  });

  /*
   * AC:       SCUM-7 AC4
   * Scenario: The smallest valid capacity, on create and on a partial update.
   * Setup:    createVenueSchema with capacity 1; updateVenueSchema without capacity.
   * Expected: Both are accepted: 1 is the lower limit, and an edit that doesn't touch
   *           capacity keeps the saved value instead of being forced to resend it.
   * Type:     boundary
   */
  it('accepts capacity 1 and lets an update leave capacity out', () => {
    expect(createVenueSchema.parse({ name: 'Studio', capacity: 1 })).toEqual({ name: 'Studio', capacity: 1 });
    expect(updateVenueSchema.parse({ facilities: 'Projector' })).toEqual({ facilities: 'Projector' });
  });

  /*
   * AC:       SCUM-7 AC2 + AC4
   * Scenario: An edit tries to set capacity to 0 or a negative number.
   * Setup:    updateVenueSchema, as run by PATCH /api/venues/:id.
   * Expected: Rejected, so an edit can't make a complete venue incomplete.
   * Type:     error
   */
  it('rejects capacity below 1 on update', () => {
    expect(() => updateVenueSchema.parse({ capacity: 0 })).toThrow('Capacity must be at least 1');
    expect(() => updateVenueSchema.parse({ capacity: -1 })).toThrow('Capacity must be at least 1');
  });

  /*
   * AC:       SCUM-7 AC2 (editing layouts)
   * Scenario: An update sends an existing layout with no name and without deleting it.
   * Setup:    updateVenueSchema with { id: 3 }, then { id: 3, deleted: true }.
   * Expected: The first is rejected (it would leave a blank layout); the second is a valid
   *           delete, which needs no name.
   * Type:     error
   */
  it('requires a layout name unless the layout is being deleted', () => {
    expect(() => updateVenueSchema.parse({ layouts: [{ id: 3 }] }))
      .toThrow('A layout name is required unless the layout is being deleted');
    expect(updateVenueSchema.parse({ layouts: [{ id: 3, deleted: true }] }))
      .toEqual({ layouts: [{ id: 3, deleted: true }] });
  });

  it('normalizes cleared optional text and rejects cleared mandatory text', () => {
    expect(updateVenueSchema.parse({
      name: 'Studio',
      facilities: '   ',
      accessibility: '',
    })).toMatchObject({
      name: 'Studio',
      facilities: null,
      accessibility: null,
    });
    expect(() => updateVenueSchema.parse({ name: '' })).toThrow(/too small|Venue name is required/i);
  });

  it('rejects a duplicate venue name and location while allowing different locations', async () => {
    const query = { select: jest.fn().mockReturnThis() };
    db.supabase.from.mockReturnValue(query);
    db.fetchMany.mockResolvedValue([
      { id: 2, name: 'Auditorium 1', location: 'Location A' },
    ]);

    await expect(createVenue(
      { id: 1, roles: ['VENUE_STAFF'] },
      // Capacity is included so the request is complete and only the duplicate is wrong.
      { name: 'auditorium 1', location: 'location a', capacity: 10 }
    )).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_VENUE' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  it('returns 404 without updating a missing venue', async () => {
    const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
    db.supabase.from.mockReturnValue(query);
    db.fetchOne.mockResolvedValue(null);

    await expect(updateVenue({ id: 1, roles: ['VENUE_STAFF'] }, 99, {}))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('updates, deletes, and adds only the requested layout rows', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };
    db.supabase.from.mockReturnValue(query);
    db.fetchOne
      .mockResolvedValueOnce({ id: 7, name: 'Studio', location: 'A', capacity: 0 })
      .mockResolvedValueOnce(null);
    db.fetchMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 10, venue_id: 7, layout: 'THEATRE' },
        { id: 11, venue_id: 7, layout: 'CLASSROOM' },
      ])
      .mockResolvedValueOnce([{ id: 7, name: 'Studio', capacity: 0, is_active: true }])
      .mockResolvedValueOnce([{ id: 10, venue_id: 7, layout: 'SEMINAR ROOM' }]);
    db.updateById.mockResolvedValue({ id: 7 });

    const result = await updateVenue(
      { id: 1, roles: ['VENUE_STAFF'] },
      7,
      {
        layouts: [
          { id: 10, layout: 'SEMINAR ROOM' },
          { id: 11, deleted: true },
          { layout: 'BANQUET' },
        ],
        isActive: false,
      }
    );

    expect(db.updateById).toHaveBeenCalledWith(
      'venues',
      7,
      expect.objectContaining({ is_active: false })
    );
    expect(db.updateById).toHaveBeenCalledWith('venue_layouts', 10, { layout: 'SEMINAR ROOM' });
    expect(query.delete).toHaveBeenCalled();
    expect(db.insertOne).toHaveBeenCalledWith('venue_layouts', { venue_id: 7, layout: 'BANQUET' });
    expect(result).toMatchObject({
      id: 7,
      layouts: ['SEMINAR ROOM'],
      layoutDetails: [{ id: 10, venue_id: 7, layout: 'SEMINAR ROOM' }],
    });
  });
});

describe('SCUM-7 venue create and update (service)', () => {
  const STAFF = { id: 1, roles: ['VENUE_STAFF'] };
  let query;

  beforeEach(() => {
    jest.clearAllMocks();
    db.fetchMany.mockReset();
    db.fetchOne.mockReset();
    query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };
    db.supabase.from.mockReturnValue(query);
  });

  /*
   * AC:       SCUM-7 AC1
   * Scenario: Venue Staff add a complete new venue.
   * Setup:    No existing venue with that name and location. The payload has every AC1
   *           field, including a repeated and a blank layout.
   * Expected: The venue row is saved with each field, layouts are saved once each (blank
   *           and repeated ones dropped), the action is audited, and the saved venue is
   *           returned as the catalogue now shows it.
   * Type:     normal
   */
  it('saves a new venue with all its details, layouts and an audit record', async () => {
    db.fetchMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 5, name: 'Orchid Boardroom', capacity: 16, is_active: true }])
      .mockResolvedValueOnce([{ id: 30, venue_id: 5, layout: 'BOARDROOM' }, { id: 31, venue_id: 5, layout: 'CLASSROOM' }]);
    db.insertOne.mockResolvedValue({ id: 5 });
    const payload = {
      name: 'Orchid Boardroom',
      location: 'Level 8',
      capacity: 16,
      facilities: 'Video conferencing',
      accessibility: 'Lift access',
      operatingHours: '08:00 - 22:00',
      layouts: ['BOARDROOM', ' BOARDROOM ', '', 'CLASSROOM'],
    };

    const result = await createVenue(STAFF, payload);

    expect(db.insertOne).toHaveBeenCalledWith('venues', {
      name: 'Orchid Boardroom',
      location: 'Level 8',
      capacity: 16,
      facilities: 'Video conferencing',
      accessibility: 'Lift access',
      operating_hours: '08:00 - 22:00',
      setup_minutes: 30,
      teardown_minutes: 30,
    });
    expect(db.insertMany).toHaveBeenCalledWith('venue_layouts', [
      { venue_id: 5, layout: 'BOARDROOM' },
      { venue_id: 5, layout: 'CLASSROOM' },
    ]);
    expect(audit.writeAudit).toHaveBeenCalledWith(1, 'VENUE_CREATED', 'venue', 5, payload);
    expect(result).toMatchObject({ id: 5, name: 'Orchid Boardroom', capacity: 16, layouts: ['BOARDROOM', 'CLASSROOM'] });
  });

  /*
   * AC:       SCUM-7 AC1
   * Scenario: Venue Staff add a venue with only the required details.
   * Setup:    Payload with name and capacity only; no layouts.
   * Expected: Optional details are stored as empty (null) rather than blank strings, and no
   *           layout rows are written, so "not recorded" is distinguishable from a value.
   * Type:     boundary
   */
  it('saves a venue with only a name and capacity', async () => {
    db.fetchMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 6, name: 'Studio', capacity: 1 }]).mockResolvedValueOnce([]);
    db.insertOne.mockResolvedValue({ id: 6 });

    await createVenue(STAFF, { name: 'Studio', capacity: 1 });

    expect(db.insertOne).toHaveBeenCalledWith('venues', expect.objectContaining({
      location: null, facilities: null, accessibility: null, operating_hours: null,
    }));
    expect(db.insertMany).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCUM-7 AC4
   * Scenario: The service is called without a venue name, e.g. bypassing the route validator.
   * Setup:    Venue Staff; payload with a capacity but no name.
   * Expected: 400 "Venue name is required" and nothing is inserted.
   * Type:     error
   */
  it('refuses to save a new venue without a name', async () => {
    await expect(createVenue(STAFF, { capacity: 10 }))
      .rejects.toMatchObject({ status: 400, message: 'Venue name is required' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCUM-7 AC4
   * Scenario: The service is called without a capacity, e.g. bypassing the route validator.
   * Setup:    Venue Staff; payload with a name only.
   * Expected: 400, and nothing is inserted, so the database never holds an incomplete venue.
   * Type:     error
   */
  it('refuses to save a new venue without a capacity', async () => {
    await expect(createVenue(STAFF, { name: 'Studio' }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCUM-7 AC2
   * Scenario: Venue Staff edit a venue's ordinary details.
   * Setup:    Venue 7 exists; no other venue has the new name. The payload changes name,
   *           capacity, facilities and operating hours only.
   * Expected: Only those columns (plus updated_at) are written, so fields that weren't sent
   *           keep their saved values, and the updated venue is returned.
   * Type:     normal
   */
  it('updates only the fields that were sent', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 7, name: 'Studio', location: 'A', capacity: 20 });
    db.fetchMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7, name: 'Studio 7', capacity: 40, is_active: true }])
      .mockResolvedValueOnce([]);

    const result = await updateVenue(STAFF, 7, {
      name: 'Studio 7',
      capacity: 40,
      facilities: 'PA system',
      operatingHours: '09:00 - 18:00',
    });

    const patch = db.updateById.mock.calls[0][2];
    expect(db.updateById).toHaveBeenCalledWith('venues', 7, expect.any(Object));
    // Exactly these keys: an unsent field such as accessibility must not be overwritten.
    expect(Object.keys(patch).sort()).toEqual(['capacity', 'facilities', 'name', 'operating_hours', 'updated_at']);
    expect(patch).toMatchObject({ name: 'Studio 7', capacity: 40, facilities: 'PA system', operating_hours: '09:00 - 18:00' });
    expect(result).toMatchObject({ id: 7, name: 'Studio 7', capacity: 40 });
  });

  /*
   * AC:       SCUM-7 AC2 + AC4
   * Scenario: An edit sets capacity to 0.
   * Setup:    Venue 7 exists with capacity 20.
   * Expected: 400 and no update, so the saved capacity stays 20.
   * Type:     error
   */
  it('refuses an update that sets capacity to 0', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 7, name: 'Studio', location: 'A', capacity: 20 });
    await expect(updateVenue(STAFF, 7, { capacity: 0 }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCUM-7 AC5
   * Scenario: A user who isn't Venue Staff tries to add or edit a venue.
   * Setup:    hasRole returns false for this call (e.g. an Event Coordinator).
   * Expected: 403 for both, before any database read or write, so the catalogue can't be
   *           changed by other roles even if the route check were bypassed.
   * Type:     error
   */
  it.each([
    ['add', () => createVenue({ id: 2, roles: ['EVENT_COORDINATOR'] }, { name: 'Studio', capacity: 10 })],
    ['edit', () => updateVenue({ id: 2, roles: ['EVENT_COORDINATOR'] }, 7, { capacity: 10 })],
  ])('rejects a non-Venue Staff user trying to %s a venue', async (_action, call) => {
    hasRole.mockReturnValueOnce(false);
    await expect(call()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.fetchOne).not.toHaveBeenCalled();
    expect(db.fetchMany).not.toHaveBeenCalled();
    expect(db.insertOne).not.toHaveBeenCalled();
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCUM-7 AC2 (editing layouts)
   * Scenario: An edit refers to a layout id that doesn't belong to this venue.
   * Setup:    Venue 7 has no layout rows; the request renames layout 99.
   * Expected: 404 "Venue layout not found", and no layout is changed or added.
   * Type:     error
   */
  it('returns 404 for a layout that does not belong to the venue', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 7, name: 'Studio', location: 'A', capacity: 20 });
    db.fetchMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(updateVenue(STAFF, 7, { layouts: [{ id: 99, layout: 'BANQUET' }] }))
      .rejects.toMatchObject({ status: 404, message: 'Venue layout not found' });
    expect(db.updateById).not.toHaveBeenCalledWith('venue_layouts', expect.anything(), expect.anything());
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCUM-7 AC4 (duplicate entries)
   * Scenario: An edit adds a layout the venue already supports.
   * Setup:    Venue 7 already has THEATRE; the request adds THEATRE again.
   * Expected: 409 "Duplicate venue layout", and no new layout row is inserted.
   * Type:     error
   */
  it('returns 409 when adding a layout the venue already has', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 7, name: 'Studio', location: 'A', capacity: 20 });
    db.fetchMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 10, venue_id: 7, layout: 'THEATRE' }]);

    await expect(updateVenue(STAFF, 7, { layouts: [{ layout: 'THEATRE' }] }))
      .rejects.toMatchObject({ status: 409, code: 'DUPLICATE_LAYOUT' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });
});
