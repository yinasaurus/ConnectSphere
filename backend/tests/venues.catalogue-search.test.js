jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const { ROLES } = require('../src/constants/roles');
const { createVenue, updateVenue, searchVenues } = require('../src/services/venues.service');

const staff = { id: 1, roles: [ROLES.VENUE_STAFF] };

// In-memory stand-in for the venues and venue_layouts tables, so a write made by
// createVenue/updateVenue is what the next searchVenues call reads back.
function useInMemoryTables(tables) {
  let nextId = 100;
  const rowsFor = (query) => tables[query.table].filter((row) => (
    query.filters.every(([column, value]) => String(row[column]) === String(value))
  ));

  db.supabase.from.mockImplementation((table) => {
    const query = { table, filters: [] };
    query.select = () => query;
    query.order = () => query;
    query.eq = (column, value) => {
      query.filters.push([column, value]);
      return query;
    };
    return query;
  });
  db.fetchMany.mockImplementation(async (query) => rowsFor(query));
  db.fetchOne.mockImplementation(async (query) => rowsFor(query)[0] || null);
  db.insertOne.mockImplementation(async (table, row) => {
    const created = { id: nextId++, is_active: true, ...row };
    tables[table].push(created);
    return created;
  });
  db.insertMany.mockImplementation(async (table, rows) => {
    const created = rows.map((row) => ({ id: nextId++, ...row }));
    tables[table].push(...created);
    return created;
  });
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = tables[table].find((item) => Number(item.id) === Number(id));
    Object.assign(row, patch);
    return row;
  });
}

describe('SCUM-7 AC3 catalogue changes reflect instantly in search', () => {
  let tables;

  beforeEach(() => {
    jest.clearAllMocks();
    tables = {
      venues: [{
        id: 1,
        name: 'Helix Hall',
        location: 'Level 2',
        capacity: 180,
        facilities: 'Projector',
        accessibility: 'Wheelchair access',
        is_active: true,
      }],
      venue_layouts: [{ id: 1, venue_id: 1, layout: 'THEATRE' }],
    };
    useInMemoryTables(tables);
  });

  /*
   * AC:       SCUM-7 AC3
   * Scenario: Venue Staff add a new venue, then a coordinator searches straight away.
   * Setup:    Catalogue holds Helix Hall; createVenue adds Studio 9 (Level 5, 40 seats, BANQUET).
   * Expected: The very next search by location and layout returns Studio 9, with no
   *           refresh or cache step in between.
   * Type:     happy
   */
  it('returns a newly added venue in the next search', async () => {
    await createVenue(staff, {
      name: 'Studio 9',
      location: 'Level 5',
      capacity: 40,
      facilities: 'Whiteboard',
      layouts: ['BANQUET'],
    });

    const result = await searchVenues({ location: 'Level 5', layout: 'BANQUET' });

    expect(result.map((venue) => venue.name)).toEqual(['Studio 9']);
  });

  /*
   * AC:       SCUM-7 AC3
   * Scenario: Venue Staff change a venue's capacity and add a layout, then search again.
   * Setup:    Helix Hall starts at 180 seats with THEATRE only; updateVenue sets 300 seats
   *           and adds CLASSROOM.
   * Expected: Searches for 250+ seats and for CLASSROOM now find Helix Hall straight away,
   *           where both found nothing before the update.
   * Type:     happy
   */
  it('reflects an updated capacity and new layout in the next search', async () => {
    expect(await searchVenues({ capacityMin: 250 })).toEqual([]);
    expect(await searchVenues({ layout: 'CLASSROOM' })).toEqual([]);

    await updateVenue(staff, 1, { capacity: 300, layouts: [{ layout: 'CLASSROOM' }] });

    expect((await searchVenues({ capacityMin: 250 })).map((venue) => venue.id)).toEqual([1]);
    expect((await searchVenues({ layout: 'CLASSROOM' })).map((venue) => venue.id)).toEqual([1]);
  });

  /*
   * AC:       SCUM-7 AC3
   * Scenario: Venue Staff deactivate a venue, then a coordinator searches.
   * Setup:    Helix Hall is active and matches a Level 2 search; updateVenue sets isActive false.
   * Expected: The same search returns nothing straight away, so coordinators can't pick a
   *           venue that is no longer offered.
   * Type:     edge
   */
  it('drops a deactivated venue from the next search', async () => {
    expect((await searchVenues({ location: 'Level 2' })).map((venue) => venue.id)).toEqual([1]);

    await updateVenue(staff, 1, { isActive: false });

    expect(await searchVenues({ location: 'Level 2' })).toEqual([]);
  });
});
