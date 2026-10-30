import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@aetheria/contracts';
import {
  DuplicateEmailError,
  type AuthStore,
  type NewUser,
  type RefreshTokenRecord,
  type UserRecord,
} from './types.js';

/** In-memory store used by tests and for running the service without MongoDB. */
export class MemoryAuthStore implements AuthStore {
  users = new Map<string, UserRecord>();
  tokens = new Map<string, RefreshTokenRecord>();
  outbox: { event: EventEnvelope; published: boolean }[] = [];

  async createUser(user: NewUser, event: EventEnvelope) {
    for (const u of this.users.values())
      if (u.email === user.email) throw new DuplicateEmailError();
    const rec: UserRecord = { ...user, createdAt: new Date() };
    this.users.set(rec.id, rec);
    this.outbox.push({ event, published: false });
    return rec;
  }
  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findUserByGoogleId(googleId: string) {
    return [...this.users.values()].find((u) => u.googleId === googleId) ?? null;
  }
  async linkGoogleId(userId: string, googleId: string) {
    const u = this.users.get(userId);
    if (u) u.googleId = googleId;
  }
  async insertRefreshToken(token: Omit<RefreshTokenRecord, 'id' | 'revokedAt'>) {
    const rec = { ...token, id: randomUUID(), revokedAt: null };
    this.tokens.set(rec.id, rec);
    return rec;
  }
  async findRefreshTokenByHash(tokenHash: string) {
    return [...this.tokens.values()].find((t) => t.tokenHash === tokenHash) ?? null;
  }
  async revokeRefreshToken(id: string) {
    const t = this.tokens.get(id);
    if (!t || t.revokedAt) return false;
    t.revokedAt = new Date();
    return true;
  }
  async revokeFamily(family: string) {
    for (const t of this.tokens.values())
      if (t.family === family && !t.revokedAt) t.revokedAt = new Date();
  }
  async pending(limit: number) {
    return this.outbox
      .filter((o) => !o.published)
      .slice(0, limit)
      .map((o) => o.event);
  }
  async markPublished(eventId: string) {
    const o = this.outbox.find((x) => x.event.id === eventId);
    if (o) o.published = true;
  }
  async ping() {
    return true;
  }
}
