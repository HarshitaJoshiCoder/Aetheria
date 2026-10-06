import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Role } from '@aetheria/contracts';
import { AppError } from './errors.js';

/**
 * The gateway verifies the user's JWT once, then forwards identity to services in
 * these headers, signed with a secret only the gateway and services share. Services
 * never trust identity headers without a valid signature, so a request that bypasses
 * the gateway cannot impersonate a user.
 */
export const INTERNAL_HEADERS = {
  userId: 'x-user-id',
  role: 'x-user-role',
  timestamp: 'x-auth-ts',
  signature: 'x-auth-signature',
} as const;

const MAX_SKEW_MS = 60_000;

export interface InternalIdentity {
  userId: string;
  role: Role;
}

function sign(secret: string, userId: string, role: string, ts: string): string {
  return createHmac('sha256', secret).update(`${userId}|${role}|${ts}`).digest('hex');
}

export function signIdentity(
  secret: string,
  identity: InternalIdentity,
  now = Date.now(),
): Record<string, string> {
  const ts = String(now);
  return {
    [INTERNAL_HEADERS.userId]: identity.userId,
    [INTERNAL_HEADERS.role]: identity.role,
    [INTERNAL_HEADERS.timestamp]: ts,
    [INTERNAL_HEADERS.signature]: sign(secret, identity.userId, identity.role, ts),
  };
}

export function verifyIdentity(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  now = Date.now(),
): InternalIdentity | null {
  const get = (k: string) => {
    const v = headers[k];
    return typeof v === 'string' ? v : undefined;
  };
  const userId = get(INTERNAL_HEADERS.userId);
  const role = get(INTERNAL_HEADERS.role);
  const ts = get(INTERNAL_HEADERS.timestamp);
  const signature = get(INTERNAL_HEADERS.signature);
  if (!userId || !role || !ts || !signature) return null;
  if (!Role.safeParse(role).success) return null;
  const age = Math.abs(now - Number(ts));
  if (!Number.isFinite(age) || age > MAX_SKEW_MS) return null;
  const expected = Buffer.from(sign(secret, userId, role, ts), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId, role: role as Role };
}

declare module 'express-serve-static-core' {
  interface Request {
    identity?: InternalIdentity;
  }
}

/** Attach a verified identity to req.identity when present; reject if `required`. */
export function internalAuth(
  secret: string,
  opts: { required?: boolean; roles?: Role[] } = {},
): RequestHandler {
  return (req, _res, next) => {
    const identity = verifyIdentity(secret, req.headers);
    if (!identity) {
      if (opts.required || opts.roles) return next(AppError.unauthorized());
      return next();
    }
    if (opts.roles && !opts.roles.includes(identity.role)) return next(AppError.forbidden());
    req.identity = identity;
    next();
  };
}
