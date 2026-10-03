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
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});
