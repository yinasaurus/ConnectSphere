const request = require('supertest');
const { createApp } = require('../src/app');

describe('auth', () => {
  const app = createApp();

  it('rejects login with missing fields without hitting user lookup semantics', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/email and password are required/i);
  });

  it('rejects an invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'secret' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('does not set a session cookie on validation failure', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: '', password: '' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects /me without a session cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('clears the session cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    const cookie = res.headers['set-cookie']?.join(';') || '';
    expect(cookie).toMatch(/cs_session=/);
  });
});
