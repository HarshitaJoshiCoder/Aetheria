import { describe, expect, it } from 'vitest';
import { signIdentity, verifyIdentity, INTERNAL_HEADERS } from './internal-auth.js';

const secret = 'test-secret';

describe('internal identity headers', () => {
  it('round-trips a signed identity', () => {
    const headers = signIdentity(secret, { userId: 'u1', role: 'admin' });
    expect(verifyIdentity(secret, headers)).toEqual({ userId: 'u1', role: 'admin' });
  });

  it('rejects a tampered role', () => {
    const headers = signIdentity(secret, { userId: 'u1', role: 'customer' });
    headers[INTERNAL_HEADERS.role] = 'admin';
    expect(verifyIdentity(secret, headers)).toBeNull();
  });

  it('rejects a different secret', () => {
    const headers = signIdentity('other', { userId: 'u1', role: 'customer' });
    expect(verifyIdentity(secret, headers)).toBeNull();
  });

  it('rejects stale signatures', () => {
    const headers = signIdentity(secret, { userId: 'u1', role: 'customer' }, Date.now() - 120_000);
    expect(verifyIdentity(secret, headers)).toBeNull();
  });

  it('returns null when headers are missing', () => {
    expect(verifyIdentity(secret, {})).toBeNull();
  });
});
