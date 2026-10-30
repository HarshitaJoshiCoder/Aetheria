import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { AccessTokenClaims, type Role } from '@aetheria/contracts';
import { AppError, INTERNAL_HEADERS, signIdentity } from '@aetheria/common';

export const ACCESS_TOKEN_ISSUER = 'aetheria-auth';

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

/**
 * Strip any identity headers the client sent, then, if a valid bearer token is present,
 * replace them with signed ones the services can trust. An invalid token is a 401 rather
 * than silently anonymous, so the client knows to refresh.
 */
export function attachIdentity(accessSecret: string, internalSecret: string): RequestHandler {
  return (req, _res, next) => {
    for (const h of Object.values(INTERNAL_HEADERS)) delete req.headers[h];

    const header = req.header('authorization');
    if (!header) return next();
    const match = /^Bearer (.+)$/i.exec(header);
    const claims = match ? verifyAccessToken(match[1]!, accessSecret) : null;
    if (!claims)
      return next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid or expired'));

    Object.assign(
      req.headers,
      signIdentity(internalSecret, { userId: claims.sub, role: claims.role }),
    );
    req.identity = { userId: claims.sub, role: claims.role };
    // Services get identity from the signed headers; the raw token stays at the edge.
    delete req.headers.authorization;
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.identity) return next(AppError.unauthorized());
    if (!roles.includes(req.identity.role)) return next(AppError.forbidden());
    next();
  };
}
