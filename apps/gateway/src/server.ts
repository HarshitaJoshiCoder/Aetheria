import { createLogger } from '@aetheria/common';
import { createGateway } from './app.js';
import { loadConfig } from './config.js';

const logger = createLogger('gateway');
const config = loadConfig();

const app = createGateway({
  logger,
  accessSecret: config.JWT_ACCESS_SECRET,
  internalSecret: config.INTERNAL_AUTH_SECRET,
  corsOrigins: config.CORS_ORIGINS,
  upstreamTimeoutMs: config.UPSTREAM_TIMEOUT_MS,
  trustProxy: config.NODE_ENV === 'production',
  routes: [
    // Tighter limit on auth to slow down password guessing.
    {
      prefix: '/api/v1/auth',
      target: config.AUTH_SERVICE_URL,
      servicePrefix: '/auth',
      rateLimitPerMinute: 20,
    },
  ],
});

app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'gateway listening'));
