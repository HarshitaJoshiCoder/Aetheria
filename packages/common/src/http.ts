import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler, type Router } from 'express';
import { ZodError, type z } from 'zod';
import { AppError } from './errors.js';
import type { Logger } from './logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Reuse the caller's request id (set by the gateway) or mint one, and echo it back. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};

/** Wrap an async handler so rejections reach the error middleware. */
export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validate and return a request body, throwing a 400 with field details on failure. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw AppError.badRequest('Invalid request body', result.error.flatten().fieldErrors);
  }
  return result.data;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) =>
  next(AppError.notFound('Route not found'));

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      err = AppError.badRequest('Invalid request', err.flatten().fieldErrors);
    }
    // body-parser errors (malformed JSON, payload too large) carry a status
    if (!(err instanceof AppError) && typeof err?.status === 'number' && err.status < 500) {
      err = new AppError(err.status, 'BAD_REQUEST', err.expose ? err.message : 'Bad request');
    }
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    logger.error({ err, requestId: req.header(REQUEST_ID_HEADER) }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
}

/** Liveness and readiness probes. `ready` should check the service's dependencies. */
export function healthRouter(ready: () => Promise<boolean> = async () => true): Router {
  const router = express.Router();
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      const ok = await ready().catch(() => false);
      res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable' });
    }),
  );
  return router;
}
