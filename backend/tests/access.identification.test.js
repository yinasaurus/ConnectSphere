jest.mock('../src/config/db', () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('Password123!', 10);
  const usersByEmail = {
    'lead@connectsphere.sg': {
      id: 11,
      email: 'lead@connectsphere.sg',
      password_hash: passwordHash,
      full_name: 'Ivy Tan',
      phone: null,
      organisation_id: null,
      department: 'Event Operations',
      communication_preference: 'IN_APP',
      is_active: true,
      roles: ['EVENT_COORDINATOR_LEAD'],
    },
    'safety@connectsphere.sg': {
      id: 12,
      email: 'safety@connectsphere.sg',
      password_hash: passwordHash,
      full_name: 'Kai Rahman',
      phone: null,
      organisation_id: null,
      department: 'Safety',
      communication_preference: 'IN_APP',
      is_active: true,
      roles: ['SAFETY_OFFICER'],
    },
    'leadcoord@connectsphere.sg': {
      id: 13,
      email: 'leadcoord@connectsphere.sg',
      password_hash: passwordHash,
      full_name: 'Jordan Ng',
      phone: null,
      organisation_id: null,
      department: 'Event Operations',
      communication_preference: 'IN_APP',
      is_active: true,
      roles: ['EVENT_COORDINATOR', 'EVENT_COORDINATOR_LEAD'],
    },
    'coordinator@connectsphere.sg': {
      id: 14,
      email: 'coordinator@connectsphere.sg',
      password_hash: passwordHash,
      full_name: 'Chloe Lim',
      phone: null,
      organisation_id: null,
      department: 'Event Operations',
      communication_preference: 'IN_APP',
      is_active: true,
      roles: ['EVENT_COORDINATOR'],
    },
  };
  const usersById = Object.fromEntries(
    Object.values(usersByEmail).map((user) => [String(user.id), user])
  );

  function from(table) {
    const filters = {};
    const query = {
      select() { return query; },
      eq(column, value) {
        filters[column] = value;
        return query;
      },
      maybeSingle: async () => ({ data: resolveOne(table, filters), error: null }),
      then(resolve, reject) {
        return Promise.resolve({ data: resolveMany(table, filters), error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  function resolveOne(table, filters) {
    if (table !== 'users') return null;
    if (filters.email) return usersByEmail[filters.email] ? { ...usersByEmail[filters.email] } : null;
    if (filters.id) return usersById[String(filters.id)] ? { ...usersById[String(filters.id)] } : null;
    return null;
  }

  function resolveMany(table, filters) {
    if (table === 'user_roles' && filters.user_id != null) {
      const user = usersById[String(filters.user_id)];
      return (user?.roles || []).map((role) => ({ role }));
    }
    return [];
  }

  async function fetchOne(builder) {
    const { data, error } = await builder.maybeSingle();
    if (error) throw error;
    return data;
  }

  async function fetchMany(builder) {
    const { data, error } = await builder;
    if (error) throw error;
    return data || [];
  }

  return {
    supabase: { from },
    fetchOne,
    fetchMany,
    fetchCount: async () => 0,
    insertOne: async () => ({}),
    insertMany: async () => [],
    updateById: async () => ({}),
    throwIf: (error) => { if (error) throw error; },
    pingDatabase: async () => {},
  };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');

const PASSWORD = 'Password123!';

describe('SCRUM-54 role identification after login', () => {
  const app = createApp();

  function login(email) {
    return request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  }

  /*
   * AC: SCRUM-54 AC1
   * Scenario: An Event Coordinator Lead signs in with valid credentials.
   * Setup: Seed-shaped account lead@connectsphere.sg whose only role is EVENT_COORDINATOR_LEAD.
   * Expected: The login payload identifies them as a Lead (roles includes EVENT_COORDINATOR_LEAD).
   * Type: normal
   */
  it('identifies an Event Coordinator Lead as a Lead after a valid login', async () => {
    const res = await login('lead@connectsphere.sg');
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual([ROLES.EVENT_COORDINATOR_LEAD]);
    expect(res.body.user.role).toBe(ROLES.EVENT_COORDINATOR_LEAD);
  });

  /*
   * AC: SCRUM-54 AC1
   * Scenario: A Safety Officer signs in with valid credentials.
   * Setup: Seed-shaped account safety@connectsphere.sg whose only role is SAFETY_OFFICER.
   * Expected: The login payload identifies them as a Safety Officer.
   * Type: normal
   */
  it('identifies a Safety Officer as a Safety Officer after a valid login', async () => {
    const res = await login('safety@connectsphere.sg');
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual([ROLES.SAFETY_OFFICER]);
    expect(res.body.user.role).toBe(ROLES.SAFETY_OFFICER);
  });

  /*
   * AC: SCRUM-54 AC2
   * Scenario: An account that holds Coordinator and Lead signs in once.
   * Setup: leadcoord@connectsphere.sg has both EVENT_COORDINATOR and EVENT_COORDINATOR_LEAD.
   * Expected: Both roles are present in the same session payload so both functions can be used.
   * Type: normal
   */
  it('returns every held role in the same session for a Coordinator + Lead account', async () => {
    const res = await login('leadcoord@connectsphere.sg');
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual([ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD]);
  });

  /*
   * AC: SCRUM-54 AC1
   * Scenario: An Event Coordinator who is not a Lead signs in.
   * Setup: coordinator@connectsphere.sg has only EVENT_COORDINATOR.
   * Expected: They are not identified as a Lead or Safety Officer.
   * Type: boundary
   */
  it('does not identify a Coordinator-only account as Lead or Safety Officer', async () => {
    const res = await login('coordinator@connectsphere.sg');
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual([ROLES.EVENT_COORDINATOR]);
    expect(res.body.user.roles).not.toContain(ROLES.EVENT_COORDINATOR_LEAD);
    expect(res.body.user.roles).not.toContain(ROLES.SAFETY_OFFICER);
  });
});
