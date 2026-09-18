jest.mock('../src/config/db', () => {
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('Password123!', 10);
  const userRow = {
    id: 1,
    email: 'organiser@acme.example',
    password_hash: passwordHash,
    full_name: 'Aisha Rahman',
    phone: null,
    organisation_id: 1,
    department: null,
    communication_preference: 'IN_APP',
    is_active: true,
  };

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
    if (filters.email && filters.email !== userRow.email) return null;
    if (filters.id && Number(filters.id) !== userRow.id) return null;
    if (filters.email || filters.id) return { ...userRow };
    return null;
  }

  function resolveMany(table, filters) {
    if (table === 'user_roles' && Number(filters.user_id) === userRow.id) {
      return [{ role: 'EVENT_ORGANISER' }];
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
    __userRow: userRow,
  };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/config/db');

const VALID_EMAIL = 'organiser@acme.example';
const VALID_PASSWORD = 'Password123!';
const GENERIC_AUTH_ERROR = 'Invalid email or password';

describe('POST /api/auth/login (Supabase users table)', () => {
  const app = createApp();

  function login(body) {
    return request(app).post('/api/auth/login').send(body);
  }

  it('returns 200 and an httpOnly session cookie for valid credentials', async () => {
    const res = await login({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: VALID_EMAIL,
      role: 'EVENT_ORGANISER',
      roles: ['EVENT_ORGANISER'],
    });
    expect(res.body.token).toBeUndefined();

    const cookie = res.headers['set-cookie']?.join(';') || '';
    expect(cookie).toMatch(/cs_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('returns 401 with a generic message for a wrong password', async () => {
    const res = await login({ email: VALID_EMAIL, password: 'not-the-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe(GENERIC_AUTH_ERROR);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 401 with the same generic message for a non-existent email', async () => {
    const unknown = await login({
      email: 'nobody@example.com',
      password: VALID_PASSWORD,
    });
    const wrongPassword = await login({
      email: VALID_EMAIL,
      password: 'not-the-password',
    });

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body.message).toBe(GENERIC_AUTH_ERROR);
    expect(unknown.body.message).toBe(wrongPassword.body.message);
    expect(unknown.body.error).toBe(wrongPassword.body.error);
  });

  it('returns 400 when email is missing', async () => {
    const res = await login({ password: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when password is missing', async () => {
    const res = await login({ email: VALID_EMAIL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed email format', async () => {
    const res = await login({ email: 'not-an-email', password: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/valid email/i);
  });

  it('never returns or stores the password in plaintext', async () => {
    const res = await login({ email: VALID_EMAIL, password: VALID_PASSWORD });
    const payload = JSON.stringify(res.body);
    const cookie = res.headers['set-cookie']?.join(';') || '';

    expect(payload).not.toMatch(/password/i);
    expect(payload).not.toContain(VALID_PASSWORD);
    expect(cookie).not.toContain(VALID_PASSWORD);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();

    expect(db.__userRow.password_hash).not.toBe(VALID_PASSWORD);
    expect(db.__userRow.password_hash).toMatch(/^\$2[aby]\$/);
  });
});
