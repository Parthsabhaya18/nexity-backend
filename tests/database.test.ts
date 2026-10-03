import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import {
  connectDatabase,
  disconnectDatabase,
  isDatabaseConnected,
  redactMongoUri,
} from '../src/config/database';
import { errorHandler } from '../src/middlewares/errorHandler';

const Sample = mongoose.model(
  'Sample',
  new mongoose.Schema({ email: { type: String, required: true, unique: true } }),
);

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Sample.init();
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo?.stop();
});

describe('MongoDB connection', () => {
  it('connects to the configured database', () => {
    expect(isDatabaseConnected()).toBe(true);
    expect(mongoose.connection.name).toBe('nexity_test');
  });

  it('reports ready on GET /api/v1/health/ready', async () => {
    const res = await request(createApp()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: 'connected' });
  });

  it('writes and reads test data via /api/v1/health/db-test', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/api/v1/health/db-test')
      .send({ message: 'hello mongo', source: 'vitest' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('ok');
    expect(created.body.collection).toBe('health_checks');
    expect(created.body.data).toMatchObject({ message: 'hello mongo', source: 'vitest' });

    const defaults = await request(app).post('/api/v1/health/db-test');
    expect(defaults.status).toBe(201);
    expect(defaults.body.data.message).toBe('MongoDB connection test');

    const listed = await request(app).get('/api/v1/health/db-test');
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(2);
    expect(listed.body.data[0].id).toBe(defaults.body.data.id);

    const cleared = await request(app).delete('/api/v1/health/db-test');
    expect(cleared.body.deleted).toBe(2);
  });

  it('rejects invalid db-test payloads', async () => {
    const res = await request(createApp()).post('/api/v1/health/db-test').send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('redacts credentials from connection strings', () => {
    expect(redactMongoUri('mongodb+srv://user:p%40ss@cluster0.x.mongodb.net/?w=majority')).toBe(
      'mongodb+srv://***:***@cluster0.x.mongodb.net/?w=majority',
    );
    expect(redactMongoUri('mongodb://127.0.0.1:27017')).toBe('mongodb://127.0.0.1:27017');
  });
});

describe('Mongoose error mapping', () => {
  const app = express();
  app.use(express.json());
  app.post('/samples', async (req, res, next) => {
    try {
      res.status(201).json(await Sample.create(req.body));
    } catch (err) {
      next(err);
    }
  });
  app.get('/samples/:id', async (req, res, next) => {
    try {
      res.json(await Sample.findById(req.params.id));
    } catch (err) {
      next(err);
    }
  });
  app.use(errorHandler);

  it('returns 400 for schema validation errors', async () => {
    const res = await request(app).post('/samples').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('email');
  });

  it('returns 409 for duplicate keys', async () => {
    await request(app).post('/samples').send({ email: 'a@nexity.app' }).expect(201);
    const res = await request(app).post('/samples').send({ email: 'a@nexity.app' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.fields).toEqual(['email']);
  });

  it('returns 400 for malformed ObjectIds', async () => {
    const res = await request(app).get('/samples/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/_id/);
  });
});
