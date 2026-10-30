import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AccessTokenClaims } from '@aetheria/contracts';

export const ACCESS_TOKEN_ISSUER = 'aetheria-auth';

export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
): string {
  return jwt.sign({ role: claims.role }, secret, {
    subject: claims.sub,
    expiresIn: ttlSeconds,
    issuer: ACCESS_TOKEN_ISSUER,
    algorithm: 'HS256',
  });
}

/** Returns the claims, or null for any invalid, expired or malformed token. */
export function verifyAccessToken(token: string, secret: string): AccessTokenClaims | null {
  try {
    const payload = jwt.verify(token, secret, {
      issuer: ACCESS_TOKEN_ISSUER,
      algorithms: ['HS256'],
    });
    const parsed = AccessTokenClaims.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');
