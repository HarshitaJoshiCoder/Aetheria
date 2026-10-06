import { describe, expect, it } from 'vitest';
import { argon2Hasher } from './passwords.js';

describe('argon2Hasher', () => {
  it('verifies the right password and rejects others', async () => {
    const h = await argon2Hasher.hash('secret123');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await argon2Hasher.verify(h, 'secret123')).toBe(true);
    expect(await argon2Hasher.verify(h, 'secret124')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await argon2Hasher.verify('not-a-hash', 'x')).toBe(false);
  });
});
