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
const { createVenueSchema, updateVenueSchema } = require('../src/validators/venues.validators');
const { createVenue, updateVenue } = require('../src/services/venues.service');

describe('venue catalogue unit behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows omitted capacity and accepts zero when supplied', () => {
    expect(createVenueSchema.parse({ name: 'Studio', layouts: [] })).toEqual({
      name: 'Studio',
      layouts: [],
    });
    expect(updateVenueSchema.parse({ capacity: 0 })).toEqual({ capacity: 0 });
  });

  it('rejects negative capacity', () => {
    expect(() => createVenueSchema.parse({ name: 'Studio', capacity: -1 })).toThrow();
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
      { name: 'auditorium 1', location: 'location a' }
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
