import { hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

/** argon2id with OWASP-recommended minimums (19 MiB memory, 2 iterations). */
export const argon2Hasher: PasswordHasher = {
  hash: (password) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  verify: (h, password) => verify(h, password).catch(() => false),
};
