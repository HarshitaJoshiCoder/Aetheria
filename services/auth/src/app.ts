import cookieParser from 'cookie-parser';
import express, { type CookieOptions, type Response } from 'express';
import { GoogleLoginInput, LoginInput, RegisterInput } from '@aetheria/contracts';
import {
  AppError,
  asyncHandler,
  errorHandler,
  healthRouter,
  internalAuth,
  notFoundHandler,
  parseBody,
  requestId,
  type Logger,
} from '@aetheria/common';
import type { AuthService, Session } from './service.js';

export const REFRESH_COOKIE = 'aetheria_rt';

export interface AppDeps {
  service: AuthService;
  logger: Logger;
  internalSecret: string;
  secureCookies: boolean;
  ready?: () => Promise<boolean>;
}

export function createApp({ service, logger, internalSecret, secureCookies, ready }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use(healthRouter(ready));

  // Scoped to the auth routes so the refresh token is never sent anywhere else.
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict',
    path: '/api/v1/auth',
  };
  const sendSession = (res: Response, session: Session, status = 200) => {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions,
      expires: session.refreshExpiresAt,
    });
    res.status(status).json({ accessToken: session.accessToken, user: session.user });
  };

  const r = express.Router();
  r.post(
    '/register',
    asyncHandler(async (req, res) =>
      sendSession(res, await service.register(parseBody(RegisterInput, req.body)), 201),
    ),
  );
  r.post(
    '/login',
    asyncHandler(async (req, res) =>
      sendSession(res, await service.login(parseBody(LoginInput, req.body))),
    ),
  );
  r.post(
    '/google',
    asyncHandler(async (req, res) =>
      sendSession(
        res,
        await service.loginWithGoogle(parseBody(GoogleLoginInput, req.body).idToken),
      ),
    ),
  );
  r.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      try {
        sendSession(res, await service.refresh(req.cookies?.[REFRESH_COOKIE]));
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, cookieOptions);
        throw err;
      }
    }),
  );
  r.post(
    '/logout',
    asyncHandler(async (req, res) => {
      await service.logout(req.cookies?.[REFRESH_COOKIE]);
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      res.status(204).end();
    }),
  );
  r.get(
    '/me',
    internalAuth(internalSecret, { required: true }),
    asyncHandler(async (req, res) => {
      if (!req.identity) throw AppError.unauthorized();
      res.json({ user: await service.me(req.identity.userId) });
    }),
  );

  app.use('/auth', r);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
