import type { EventEnvelope, Role } from '@aetheria/contracts';
import type { OutboxStore } from '@aetheria/messaging';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  googleId: string | null;
  role: Role;
  emailVerified: boolean;
  createdAt: Date;
}

export type NewUser = Omit<UserRecord, 'createdAt'>;

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  /** All tokens descended from one login share a family; reuse of a rotated token revokes the family. */
  family: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthStore extends OutboxStore {
  /** Insert the user and enqueue the event atomically. Throws DuplicateEmailError on a taken email. */
  createUser(user: NewUser, event: EventEnvelope): Promise<UserRecord>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByGoogleId(googleId: string): Promise<UserRecord | null>;
  linkGoogleId(userId: string, googleId: string): Promise<void>;

  insertRefreshToken(
    token: Omit<RefreshTokenRecord, 'id' | 'revokedAt'>,
  ): Promise<RefreshTokenRecord>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Revoke one token; returns false if it was already revoked (so concurrent rotations lose). */
  revokeRefreshToken(id: string): Promise<boolean>;
  revokeFamily(family: string): Promise<void>;

  ping(): Promise<boolean>;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('Email already registered');
  }
}
