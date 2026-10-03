import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.environment).toBe('test');
    expect(res.body.database).toBe('disconnected');
  });

  it('reports not ready while the database is disconnected', async () => {
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
  });

  it('returns 503 from db-test while the database is disconnected', async () => {
    const res = await request(app).post('/api/v1/health/db-test');
    expect(res.status).toBe(503);
    expect(res.body.database).toBe('disconnected');
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/not found/i);
  });
});
