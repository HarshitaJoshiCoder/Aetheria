import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvent } from '@aetheria/messaging';
import { MongoAuthStore } from './mongo.js';
import { DuplicateEmailError } from './types.js';

// Runs against a real replica set (CI starts one). Skipped locally unless MONGO_TEST_URL is set.
const url = process.env.MONGO_TEST_URL;

describe.skipIf(!url)('MongoAuthStore', () => {
  let store: MongoAuthStore;

  beforeAll(async () => {
    store = await MongoAuthStore.connect(
      `${url!.replace(/\/$/, '')}/auth_test_${Date.now()}?replicaSet=rs0`,
    );
  });
  afterAll(async () => {
    await store?.close();
  });

  const newUser = (email: string) => {
    const id = randomUUID();
    return {
      user: {
        id,
        name: 'T',
        email,
        passwordHash: 'h',
        googleId: null,
        role: 'customer' as const,
        emailVerified: false,
      },
      event: createEvent(
        'user.registered',
        { userId: id, email, name: 'T', role: 'customer' },
        'test',
      ),
    };
  };

  it('creates a user and its outbox event together', async () => {
    const { user, event } = newUser('one@example.com');
    const created = await store.createUser(user, event);
    expect(created.id).toBe(user.id);
    expect(await store.findUserByEmail('one@example.com')).toMatchObject({ id: user.id });
    expect((await store.pending(10)).map((e) => e.id)).toContain(event.id);
  });

  it('rolls back the outbox event when the email is taken', async () => {
    const { user, event } = newUser('one@example.com');
    await expect(store.createUser(user, event)).rejects.toBeInstanceOf(DuplicateEmailError);
    expect((await store.pending(10)).map((e) => e.id)).not.toContain(event.id);
  });

  it('marks outbox events published', async () => {
    const [first] = await store.pending(1);
    await store.markPublished(first!.id);
    expect((await store.pending(10)).map((e) => e.id)).not.toContain(first!.id);
  });

  it('revokes a refresh token only once', async () => {
    const t = await store.insertRefreshToken({
      userId: 'u',
      tokenHash: randomUUID(),
      family: 'f1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await store.revokeRefreshToken(t.id)).toBe(true);
    expect(await store.revokeRefreshToken(t.id)).toBe(false);
  });

  it('revokes a whole family', async () => {
    const a = await store.insertRefreshToken({
      userId: 'u',
      tokenHash: randomUUID(),
      family: 'f2',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const b = await store.insertRefreshToken({
      userId: 'u',
      tokenHash: randomUUID(),
      family: 'f2',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await store.revokeFamily('f2');
    expect((await store.findRefreshTokenByHash(a.tokenHash))?.revokedAt).not.toBeNull();
    expect((await store.findRefreshTokenByHash(b.tokenHash))?.revokedAt).not.toBeNull();
  });
});
