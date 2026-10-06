import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  errorHandler,
  healthRouter,
  notFoundHandler,
  requestId,
  type Logger,
} from '@aetheria/common';
import { attachIdentity, requireRole } from './identity.js';

export interface Route {
  /** Public path prefix, e.g. /api/v1/auth */
  prefix: string;
  /** Service base URL */
  target: string;
  /** Path the service mounts these routes under, e.g. /auth */
  servicePrefix: string;
  /** Roles allowed; omitted means the service decides per route. */
  roles?: ('customer' | 'admin' | 'superadmin')[];
  /** Requests per minute per IP. */
  rateLimitPerMinute?: number;
}

export interface GatewayDeps {
  logger: Logger;
  accessSecret: string;
  internalSecret: string;
  corsOrigins: string[];
  routes: Route[];
  upstreamTimeoutMs?: number;
  trustProxy?: boolean;
}

export function createGateway(d: GatewayDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Behind Render's / Vercel's load balancer the client IP is in X-Forwarded-For.
  if (d.trustProxy) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: d.corsOrigins, credentials: true }));
  app.use(healthRouter());
  app.use(
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }),
  );
  app.use(attachIdentity(d.accessSecret, d.internalSecret));

  for (const route of d.routes) {
    const chain: express.RequestHandler[] = [];
    if (route.rateLimitPerMinute) {
      chain.push(
        rateLimit({
          windowMs: 60_000,
          limit: route.rateLimitPerMinute,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
        }),
      );
    }
    if (route.roles) chain.push(requireRole(...route.roles));
    chain.push(
      createProxyMiddleware({
        target: route.target,
        changeOrigin: true,
        xfwd: true,
        proxyTimeout: d.upstreamTimeoutMs ?? 10_000,
        timeout: d.upstreamTimeoutMs ?? 10_000,
        pathRewrite: (path) => `${route.servicePrefix}${path === '/' ? '' : path}`,
        on: {
          error: (err, _req, res) => {
            d.logger.warn({ err, target: route.target }, 'upstream unavailable');
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'content-type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Service unavailable' },
                }),
              );
            }
          },
        },
      }),
    );
    app.use(route.prefix, ...chain);
  }

  app.use(notFoundHandler);
  app.use(errorHandler(d.logger));
  return app;
}
