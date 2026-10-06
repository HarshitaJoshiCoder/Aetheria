import { randomUUID } from 'node:crypto';
import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from '@aetheria/contracts';
import { AppError } from '@aetheria/common';
import { createEvent } from '@aetheria/messaging';
import type { GoogleVerifier } from './google.js';
import type { PasswordHasher } from './passwords.js';
import { DuplicateEmailError, type AuthStore, type UserRecord } from './store/types.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';

export const SERVICE_NAME = 'auth-service';

export interface AuthServiceDeps {
  store: AuthStore;
  hasher: PasswordHasher;
  google?: GoogleVerifier;
  accessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  now?: () => Date;
}

export interface Session extends AuthResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const invalidSession = () => new AppError(401, 'INVALID_SESSION', 'Please sign in again');

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

export class AuthService {
  /** Compared against when the email is unknown, so login takes the same time either way. */
  private dummyHash: Promise<string>;

  constructor(private readonly d: AuthServiceDeps) {
    this.dummyHash = d.hasher.hash('timing-equaliser-password-1');
  }

  private now() {
    return this.d.now?.() ?? new Date();
  }

  async register(input: RegisterInput): Promise<Session> {
    const id = randomUUID();
    // Public sign-up only ever creates customers; admins are promoted by a superadmin.
    const role = 'customer' as const;
    const event = createEvent(
      'user.registered',
      { userId: id, email: input.email, name: input.name, role },
      SERVICE_NAME,
    );
    try {
      const user = await this.d.store.createUser(
        {
          id,
          name: input.name,
          email: input.email,
          passwordHash: await this.d.hasher.hash(input.password),
          googleId: null,
          role,
          emailVerified: false,
        },
        event,
      );
      return this.startSession(user);
    } catch (err) {
      if (err instanceof DuplicateEmailError)
        throw AppError.conflict('An account with this email already exists');
      throw err;
    }
  }

  async login(input: LoginInput): Promise<Session> {
    const user = await this.d.store.findUserByEmail(input.email);
    if (!user?.passwordHash) {
      await this.d.hasher.verify(await this.dummyHash, input.password);
      throw invalidCredentials();
    }
    if (!(await this.d.hasher.verify(user.passwordHash, input.password)))
      throw invalidCredentials();
    return this.startSession(user);
  }

  async loginWithGoogle(idToken: string): Promise<Session> {
    if (!this.d.google)
      throw new AppError(501, 'NOT_CONFIGURED', 'Google sign-in is not configured');
    const profile = await this.d.google.verify(idToken);
    if (!profile) throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed');

    let user = await this.d.store.findUserByGoogleId(profile.googleId);
    if (!user) {
      const byEmail = await this.d.store.findUserByEmail(profile.email);
      if (byEmail) {
        // Only link to an existing password account when Google vouches for the email.
        if (!profile.emailVerified)
          throw AppError.conflict('An account with this email already exists');
        await this.d.store.linkGoogleId(byEmail.id, profile.googleId);
        user = { ...byEmail, googleId: profile.googleId, emailVerified: true };
      } else {
        const id = randomUUID();
        const event = createEvent(
          'user.registered',
          { userId: id, email: profile.email, name: profile.name, role: 'customer' },
          SERVICE_NAME,
        );
        user = await this.d.store.createUser(
          {
            id,
            name: profile.name,
            email: profile.email,
            passwordHash: null,
            googleId: profile.googleId,
            role: 'customer',
            emailVerified: profile.emailVerified,
          },
          event,
        );
      }
    }
    return this.startSession(user);
  }

  /**
   * Rotate a refresh token. Each token works once; presenting an already-rotated token
   * means it was stolen or replayed, so the whole login family is revoked.
   */
  async refresh(refreshToken: string | undefined): Promise<Session> {
    if (!refreshToken) throw invalidSession();
    const record = await this.d.store.findRefreshTokenByHash(hashRefreshToken(refreshToken));
    if (!record) throw invalidSession();
    if (record.revokedAt) {
      await this.d.store.revokeFamily(record.family);
      throw invalidSession();
    }
    if (record.expiresAt <= this.now()) throw invalidSession();
    // Losing a concurrent rotation race is treated like reuse.
    if (!(await this.d.store.revokeRefreshToken(record.id))) {
      await this.d.store.revokeFamily(record.family);
      throw invalidSession();
    }
    const user = await this.d.store.findUserById(record.userId);
    if (!user) throw invalidSession();
    return this.startSession(user, record.family);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const record = await this.d.store.findRefreshTokenByHash(hashRefreshToken(refreshToken));
    if (record) await this.d.store.revokeFamily(record.family);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.d.store.findUserById(userId);
    if (!user) throw AppError.notFound('User not found');
    return toPublicUser(user);
  }

  private async startSession(user: UserRecord, family: string = randomUUID()): Promise<Session> {
    const { token, hash } = newRefreshToken();
    const refreshExpiresAt = new Date(this.now().getTime() + this.d.refreshTtlDays * 86_400_000);
    await this.d.store.insertRefreshToken({
      userId: user.id,
      tokenHash: hash,
      family,
      expiresAt: refreshExpiresAt,
    });
    return {
      accessToken: signAccessToken(
        { sub: user.id, role: user.role },
        this.d.accessSecret,
        this.d.accessTtlSeconds,
      ),
      user: toPublicUser(user),
      refreshToken: token,
      refreshExpiresAt,
    };
  }
}
