import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger, signIdentity } from '@aetheria/common';
import { createApp, REFRESH_COOKIE } from './app.js';
import type { GoogleVerifier } from './google.js';
import type { PasswordHasher } from './passwords.js';
import { AuthService } from './service.js';
import { MemoryAuthStore } from './store/memory.js';
import { verifyAccessToken } from './tokens.js';

const ACCESS_SECRET = 'a'.repeat(32);
const INTERNAL_SECRET = 'b'.repeat(32);

// Fast stand-in for argon2; argon2 itself is covered in passwords.test.ts.
const fakeHasher: PasswordHasher = {
  hash: async (p) => `hashed:${p}`,
  verify: async (h, p) => h === `hashed:${p}`,
};

const google: GoogleVerifier = {
  async verify(token) {
    if (token === 'good-new')
      return { googleId: 'g-1', email: 'new@example.com', emailVerified: true, name: 'New' };
    if (token === 'good-existing')
      return { googleId: 'g-2', email: 'asha@example.com', emailVerified: true, name: 'Asha' };
    return null;
  },
};

let store: MemoryAuthStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new MemoryAuthStore();
  const service = new AuthService({
    store,
    hasher: fakeHasher,
    google,
    accessSecret: ACCESS_SECRET,
    accessTtlSeconds: 900,
    refreshTtlDays: 7,
  });
  app = createApp({
    service,
    logger: createLogger('test'),
    internalSecret: INTERNAL_SECRET,
    secureCookies: false,
  });
});

const user = { name: 'Asha', email: 'Asha@Example.com', password: 'secret123' };

function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[];
  const c = raw.find((x) => x.startsWith(`${REFRESH_COOKIE}=`));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
}

describe('POST /auth/register', () => {
  it('creates a customer, returns an access token and sets an httpOnly refresh cookie', async () => {
    const res = await request(app).post('/auth/register').send(user).expect(201);
    expect(res.body.user).toMatchObject({
      name: 'Asha',
      email: 'asha@example.com',
      role: 'customer',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(verifyAccessToken(res.body.accessToken, ACCESS_SECRET)).toEqual({
      sub: res.body.user.id,
      role: 'customer',
    });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('writes a user.registered event to the outbox', async () => {
    const res = await request(app).post('/auth/register').send(user).expect(201);
    const pending = await store.pending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: 'user.registered',
      data: { userId: res.body.user.id },
    });
  });

  it('ignores a client-supplied role', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...user, role: 'admin' })
      .expect(201);
    expect(res.body.user.role).toBe('customer');
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/auth/register').send(user).expect(201);
    const res = await request(app).post('/auth/register').send(user).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password with field details', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...user, password: 'short' })
      .expect(400);
    expect(res.body.error.details.password).toBeDefined();
  });

  it('rejects malformed JSON with 400', async () => {
    await request(app)
      .post('/auth/register')
      .set('content-type', 'application/json')
      .send('{bad')
      .expect(400);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/auth/register').send(user);
  });

  it('logs in with the right password, case-insensitive email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ASHA@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const a = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'wrong123' })
      .expect(401);
    const b = await request(app)
      .post('/auth/login')
      .send({ email: 'x@y.co', password: 'wrong123' })
      .expect(401);
    expect(a.body).toEqual(b.body);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const reg = await request(app).post('/auth/register').send(user);
    const first = refreshCookie(reg);
    const res = await request(app).post('/auth/refresh').set('Cookie', first).expect(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(refreshCookie(res)).not.toBe(first);
  });

  it('revokes the whole family when an old token is reused', async () => {
    const reg = await request(app).post('/auth/register').send(user);
    const first = refreshCookie(reg);
    const rotated = await request(app).post('/auth/refresh').set('Cookie', first).expect(200);
    const second = refreshCookie(rotated);

    await request(app).post('/auth/refresh').set('Cookie', first).expect(401);
    // The legitimate newer token is now dead too.
    await request(app).post('/auth/refresh').set('Cookie', second).expect(401);
  });

  it('returns 401 without a cookie', async () => {
    await request(app).post('/auth/refresh').expect(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token', async () => {
    const reg = await request(app).post('/auth/register').send(user);
    const cookie = refreshCookie(reg);
    await request(app).post('/auth/logout').set('Cookie', cookie).expect(204);
    await request(app).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });
});

describe('GET /auth/me', () => {
  it('returns the user for a gateway-signed identity', async () => {
    const reg = await request(app).post('/auth/register').send(user);
    const headers = signIdentity(INTERNAL_SECRET, { userId: reg.body.user.id, role: 'customer' });
    const res = await request(app).get('/auth/me').set(headers).expect(200);
    expect(res.body.user.email).toBe('asha@example.com');
  });

  it('rejects unsigned identity headers', async () => {
    await request(app)
      .get('/auth/me')
      .set('x-user-id', 'someone')
      .set('x-user-role', 'admin')
      .expect(401);
  });
});

describe('POST /auth/google', () => {
  it('creates a new account from a verified Google token', async () => {
    const res = await request(app).post('/auth/google').send({ idToken: 'good-new' }).expect(200);
    expect(res.body.user).toMatchObject({ email: 'new@example.com', emailVerified: true });
  });

  it('links Google to an existing account with the same verified email', async () => {
    const reg = await request(app).post('/auth/register').send(user);
    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'good-existing' })
      .expect(200);
    expect(res.body.user.id).toBe(reg.body.user.id);
  });

  it('rejects an invalid Google token', async () => {
    await request(app).post('/auth/google').send({ idToken: 'bad' }).expect(401);
  });
});

describe('health', () => {
  it('reports live', async () => {
    await request(app).get('/health/live').expect(200);
  });
});
