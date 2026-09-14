const request = require('supertest');
const { createApp } = require('../src/app');

describe('health', () => {
  const app = createApp();

  it('returns ok without a database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
  });
});
