import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, verifyIdentity } from '@aetheria/common';
import { createGateway } from './app.js';
import { ACCESS_TOKEN_ISSUER } from './identity.js';

const ACCESS = 'a'.repeat(32);
const INTERNAL = 'b'.repeat(32);

// A fake upstream that echoes what it received.
let upstream: http.Server;
let upstreamUrl: string;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(() => upstream.close());

const token = (sub: string, role: string, secret = ACCESS) =>
  jwt.sign({ role }, secret, { subject: sub, issuer: ACCESS_TOKEN_ISSUER, expiresIn: 60 });

function gateway(extra: Partial<Parameters<typeof createGateway>[0]> = {}) {
  return createGateway({
    logger: createLogger('test'),
    accessSecret: ACCESS,
    internalSecret: INTERNAL,
    corsOrigins: ['http://localhost:5173'],
    routes: [
      { prefix: '/api/v1/auth', target: upstreamUrl, servicePrefix: '/auth' },
      {
        prefix: '/api/v1/admin',
        target: upstreamUrl,
        servicePrefix: '/admin',
        roles: ['admin', 'superadmin'],
      },
    ],
    ...extra,
  });
}

describe('gateway routing', () => {
  it('rewrites the public path to the service path and forwards the body', async () => {
    const res = await request(gateway())
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co' })
      .expect(200);
    expect(res.body.url).toBe('/auth/login');
    expect(JSON.parse(res.body.body)).toEqual({ email: 'a@b.co' });
  });

  it('keeps the query string', async () => {
    const res = await request(gateway()).get('/api/v1/auth/me?x=1').expect(200);
    expect(res.body.url).toBe('/auth/me?x=1');
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(gateway()).get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 502 when the upstream is down', async () => {
    const app = gateway({
      routes: [{ prefix: '/api/v1/auth', target: 'http://127.0.0.1:1', servicePrefix: '/auth' }],
    });
    const res = await request(app).get('/api/v1/auth/me').expect(502);
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('gateway identity', () => {
  it('forwards a signed identity for a valid token and drops the bearer token', async () => {
    const res = await request(gateway())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${token('u1', 'customer')}`)
      .expect(200);
    expect(verifyIdentity(INTERNAL, res.body.headers)).toEqual({ userId: 'u1', role: 'customer' });
    expect(res.body.headers.authorization).toBeUndefined();
  });

  it('strips spoofed identity headers from anonymous requests', async () => {
    const res = await request(gateway())
      .get('/api/v1/auth/me')
      .set('x-user-id', 'victim')
      .set('x-user-role', 'admin')
      .expect(200);
    expect(res.body.headers['x-user-id']).toBeUndefined();
    expect(res.body.headers['x-user-role']).toBeUndefined();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const res = await request(gateway())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${token('u1', 'admin', 'x'.repeat(32))}`)
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('enforces route roles', async () => {
    const app = gateway();
    await request(app).get('/api/v1/admin/stats').expect(401);
    await request(app)
      .get('/api/v1/admin/stats')
      .set('authorization', `Bearer ${token('u1', 'customer')}`)
      .expect(403);
    const ok = await request(app)
      .get('/api/v1/admin/stats')
      .set('authorization', `Bearer ${token('u2', 'admin')}`)
      .expect(200);
    expect(ok.body.url).toBe('/admin/stats');
  });
});

describe('gateway hardening', () => {
  it('sets security headers and a request id', async () => {
    const res = await request(gateway()).get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTypeOf('string');
  });

  it('only allows configured CORS origins', async () => {
    const ok = await request(gateway()).get('/health/live').set('origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(gateway()).get('/health/live').set('origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits per route', async () => {
    const app = gateway({
      routes: [
        {
          prefix: '/api/v1/auth',
          target: upstreamUrl,
          servicePrefix: '/auth',
          rateLimitPerMinute: 2,
        },
      ],
    });
    await request(app).post('/api/v1/auth/login').expect(200);
    await request(app).post('/api/v1/auth/login').expect(200);
    await request(app).post('/api/v1/auth/login').expect(429);
  });
});
