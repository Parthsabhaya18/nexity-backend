import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/modules/media/media.storage', () => ({
  abortMultipartUpload: vi.fn(async () => {}),
  deleteObjects: vi.fn(async () => {}),
  publicUrl: (key: string) => `https://cdn.test/${key}`,
  viewUrl: async (key: string) => `https://cdn.test/${key}`,
}));

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Encounter, NearbyBleSighting, NearbyBleToken, NearbyPresence } from '../src/modules/nearby/nearby.models';
import { Block } from '../src/modules/safety/block.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

type Account = { auth: string; id: string };

async function signUp(username: string): Promise<Account> {
  const email = `${username}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    display_name: username,
    username,
    email,
    password: 'secretPass1',
    gender: 'woman',
    date_of_birth: '1998-04-12',
    accept_terms: true,
  });
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email, code: reg.body.dev_code });
  return { auth: `Bearer ${verified.body.access_token as string}`, id: verified.body.user.id as string };
}

const api = (a: Account) => ({
  get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', a.auth),
  post: (path: string, body?: object) =>
    request(app).post(`/api/v1${path}`).set('Authorization', a.auth).send(body ?? {}),
  patch: (path: string, body?: object) =>
    request(app).patch(`/api/v1${path}`).set('Authorization', a.auth).send(body ?? {}),
});

async function bluetoothOn(a: Account) {
  const res = await api(a).patch('/nearby/settings', { enabled: true, bluetooth_enabled: true });
  expect(res.status).toBe(200);
}

const seen = (ephId: string) => ({
  eph_id: ephId,
  first_seen_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  count: 4,
  rssi_max: -60,
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    OtpCode.deleteMany({}),
    RefreshToken.deleteMany({}),
    Encounter.deleteMany({}),
    NearbyBleToken.deleteMany({}),
    NearbyBleSighting.deleteMany({}),
    NearbyPresence.deleteMany({}),
    Block.deleteMany({}),
  ]);
});

describe('bluetooth nearby', () => {
  it('shows a person only after both phones report each other', async () => {
    const alice = await signUp('alicebt');
    const bob = await signUp('bobbybt');
    await bluetoothOn(alice);
    await bluetoothOn(bob);
    const aTokens = await api(alice).post('/nearby/ble/tokens');
    const bTokens = await api(bob).post('/nearby/ble/tokens');
    const aId = aTokens.body.items[0].eph_id as string;
    const bId = bTokens.body.items[0].eph_id as string;

    const oneWay = await api(alice).post('/nearby/ble/sightings', { sightings: [seen(bId)] });
    expect(oneWay.status).toBe(202);
    expect(oneWay.body.accepted).toBe(1);
    expect((await api(alice).get('/nearby/users')).body.items).toHaveLength(0);
    expect((await api(bob).get('/nearby/users')).body.items).toHaveLength(0);

    const again = await api(alice).post('/nearby/ble/sightings', { sightings: [seen(bId)] });
    expect(again.status).toBe(202);
    const bobReport = await api(bob).post('/nearby/ble/sightings', { sightings: [seen(aId)] });
    expect(bobReport.status).toBe(202);
    const aroundAlice = await api(alice).get('/nearby/users');
    expect(aroundAlice.body.items).toHaveLength(1);
    expect(aroundAlice.body.items[0].user.username).toBe('bobbybt');
    expect(aroundAlice.body.items[0].user).not.toHaveProperty('email');
    const aroundBob = await api(bob).get('/nearby/users');
    expect(aroundBob.body.items[0].user.username).toBe('alicebt');
    expect(await Encounter.countDocuments()).toBe(1);
  });

  it('ignores a made-up Bluetooth id and hides someone after Bluetooth is turned off', async () => {
    const alice = await signUp('alicebt2');
    const bob = await signUp('bobbybt2');
    await bluetoothOn(alice);
    await bluetoothOn(bob);
    const aId = (await api(alice).post('/nearby/ble/tokens')).body.items[0].eph_id as string;
    const bId = (await api(bob).post('/nearby/ble/tokens')).body.items[0].eph_id as string;

    const fake = await api(alice).post('/nearby/ble/sightings', {
      sightings: [seen('not-a-real-bluetooth-id-at-all'), seen(bId)],
    });
    expect(fake.body.accepted).toBe(1);
    expect((await api(alice).get('/nearby/users')).body.items).toHaveLength(0);

    await api(bob).post('/nearby/ble/sightings', { sightings: [seen(aId)] });
    expect((await api(alice).get('/nearby/users')).body.items).toHaveLength(1);

    await api(bob).patch('/nearby/settings', { bluetooth_enabled: false });
    expect((await api(alice).get('/nearby/users')).body.items).toHaveLength(0);
    expect(await NearbyPresence.countDocuments()).toBe(0);
    const revoked = await NearbyBleToken.countDocuments({ user_id: bob.id, revoked_at: null });
    expect(revoked).toBe(0);
  });

  it('does not list a blocked person and refuses tokens while Bluetooth discovery is off', async () => {
    const alice = await signUp('alicebt3');
    const bob = await signUp('bobbybt3');
    const off = await api(alice).post('/nearby/ble/tokens');
    expect(off.body.error.code).toBe('NEARBY_DISABLED');

    await bluetoothOn(alice);
    await bluetoothOn(bob);
    const aId = (await api(alice).post('/nearby/ble/tokens')).body.items[0].eph_id as string;
    const bId = (await api(bob).post('/nearby/ble/tokens')).body.items[0].eph_id as string;
    await api(alice).post('/nearby/ble/sightings', { sightings: [seen(bId)] });
    await api(bob).post('/nearby/ble/sightings', { sightings: [seen(aId)] });
    expect((await api(alice).post(`/users/${bob.id}/block`)).status).toBe(204);
    expect((await api(alice).get('/nearby/users')).body.items).toHaveLength(0);
    expect((await api(bob).get('/nearby/users')).body.items).toHaveLength(0);
  });
});
