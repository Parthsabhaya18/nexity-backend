import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

const signup = {
  display_name: 'Riya Patel',
  username: 'riya.writes',
  email: 'Riya@Example.com',
  password: 'secretPass1',
  gender: 'woman',
  date_of_birth: '1998-04-12',
  accept_terms: true,
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), OtpCode.init(), RefreshToken.init()]);
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), OtpCode.deleteMany({}), RefreshToken.deleteMany({})]);
});

/** Lets a test request a new code without waiting for the 30-second cooldown. */
const skipCooldown = () =>
  OtpCode.updateMany({}, { $set: { last_sent_at: new Date(Date.now() - 60_000) } });

async function registerAndVerify() {
  const reg = await request(app).post('/api/v1/auth/register').send(signup);
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email: signup.email, code: reg.body.dev_code });
  return verified.body as { access_token: string; refresh_token: string };
}

describe('register + email OTP', () => {
  it('creates an unverified user and returns a dev code', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(signup);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: 'riya.writes',
      email: 'riya@example.com',
      is_verified: false,
    });
    expect(res.body.dev_code).toMatch(/^\d{6}$/);
    expect(res.body.resend_available_in).toBe(30);
    expect(res.body).not.toHaveProperty('access_token');
  });

  it('rejects future birth dates and missing terms with field errors', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...signup, date_of_birth: '2999-01-01', accept_terms: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['date_of_birth', 'accept_terms']));
  });

  it('verifies with the right code and starts a session', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send(signup);

    const wrong = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: signup.email, code: '000000' === reg.body.dev_code ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CODE');

    const ok = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: signup.email, code: reg.body.dev_code });
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);
    expect(ok.body.access_token).toBeTruthy();
    expect(ok.body.refresh_token).toBeTruthy();
    expect(ok.body.user.is_verified).toBe(true);

    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${ok.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('riya.writes');
    expect(me.body).not.toHaveProperty('password_hash');
  });

  it('blocks a taken email and username once verified', async () => {
    await registerAndVerify();
    const email = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...signup, username: 'someone.else' });
    expect(email.status).toBe(409);
    expect(email.body.error.code).toBe('EMAIL_TAKEN');

    const username = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...signup, email: 'other@example.com' });
    expect(username.status).toBe(409);
    expect(username.body.error.code).toBe('USERNAME_TAKEN');

    const avail = await request(app)
      .get('/api/v1/auth/username-available')
      .query({ username: 'riya.writes' });
    expect(avail.body).toEqual({ available: false, reason: 'taken' });
  });

  it('enforces the resend cooldown', async () => {
    await request(app).post('/api/v1/auth/register').send(signup);
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: signup.email });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RESEND_COOLDOWN');

    await skipCooldown();
    const again = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: signup.email });
    expect(again.status).toBe(200);
    expect(again.body.dev_code).toMatch(/^\d{6}$/);
  });
});

describe('login', () => {
  it('logs in with email or username', async () => {
    await registerAndVerify();
    const byEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'RIYA@example.com', password: signup.password });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user.username).toBe('riya.writes');

    const byUsername = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'riya.writes', password: signup.password });
    expect(byUsername.status).toBe(200);
  });

  it('uses one generic error for unknown users and wrong passwords', async () => {
    await registerAndVerify();
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'nobody@example.com', password: 'whatever1' });
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: 'wrongPass1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
  });

  it('locks the account after 5 wrong passwords', async () => {
    await registerAndVerify();
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: signup.email, password: 'wrongPass1' })
        .expect(401);
    }
    const fifth = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: 'wrongPass1' });
    expect(fifth.status).toBe(429);
    const correct = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: signup.password });
    expect(correct.status).toBe(429);
    expect(correct.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  }, 20_000);

  it('asks unverified users to verify and sends a code', async () => {
    await request(app).post('/api/v1/auth/register').send(signup);
    await skipCooldown();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: signup.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.error.details.email).toBe('riya@example.com');
    expect(res.body.error.details.dev_code).toMatch(/^\d{6}$/);
  });

  it('rejects disabled accounts', async () => {
    await registerAndVerify();
    await User.updateOne({ username: 'riya.writes' }, { status: 'disabled' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: signup.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('refresh + logout', () => {
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { refresh_token } = await registerAndVerify();

    const first = await request(app).post('/api/v1/auth/refresh').send({ refresh_token });
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).not.toBe(refresh_token);

    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refresh_token });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    const afterTheft = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: first.body.refresh_token });
    expect(afterTheft.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const { refresh_token } = await registerAndVerify();
    await request(app).post('/api/v1/auth/logout').send({ refresh_token }).expect(204);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refresh_token });
    expect(res.status).toBe(401);
  });

  it('rejects requests without a valid access token', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });
});

describe('forgot password with OTP', () => {
  it('returns the same response for unknown emails', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body).not.toHaveProperty('dev_code');
  });

  it('resets the password with a code and signs out every device', async () => {
    const { refresh_token } = await registerAndVerify();

    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: signup.email });
    expect(forgot.status).toBe(200);
    const code = forgot.body.dev_code as string;

    const verified = await request(app)
      .post('/api/v1/auth/verify-reset-code')
      .send({ email: signup.email, code });
    expect(verified.status).toBe(200);
    expect(verified.body.reset_token).toBeTruthy();

    const reused = await request(app)
      .post('/api/v1/auth/verify-reset-code')
      .send({ email: signup.email, code });
    expect(reused.status).toBe(400);

    const weak = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ reset_token: verified.body.reset_token, password: 'short' });
    expect(weak.status).toBe(400);

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ reset_token: verified.body.reset_token, password: 'brandNew2' })
      .expect(204);

    const again = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ reset_token: verified.body.reset_token, password: 'another3x' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_RESET_TOKEN');

    const oldSession = await request(app).post('/api/v1/auth/refresh').send({ refresh_token });
    expect(oldSession.status).toBe(401);

    const oldPw = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: signup.password });
    expect(oldPw.status).toBe(401);
    const newPw = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: signup.email, password: 'brandNew2' });
    expect(newPw.status).toBe(200);
  });
});
