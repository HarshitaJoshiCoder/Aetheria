import { createLogger } from '@aetheria/common';
import { OutboxRelay, RabbitBus } from '@aetheria/messaging';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createGoogleVerifier } from './google.js';
import { argon2Hasher } from './passwords.js';
import { AuthService } from './service.js';
import { MongoAuthStore } from './store/mongo.js';

const logger = createLogger('auth-service');

async function main() {
  const config = loadConfig();
  const store = await MongoAuthStore.connect(config.MONGO_URL);
  const bus = await RabbitBus.connect(config.RABBITMQ_URL, logger);
  const relay = new OutboxRelay(store, bus, logger);
  relay.start();

  const service = new AuthService({
    store,
    hasher: argon2Hasher,
    ...(config.GOOGLE_CLIENT_ID ? { google: createGoogleVerifier(config.GOOGLE_CLIENT_ID) } : {}),
    accessSecret: config.JWT_ACCESS_SECRET,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
  });

  const app = createApp({
    service,
    logger,
    internalSecret: config.INTERNAL_AUTH_SECRET,
    secureCookies: config.NODE_ENV === 'production',
    ready: () => store.ping(),
  });
  const server = app.listen(config.PORT, () =>
    logger.info({ port: config.PORT }, 'auth-service listening'),
  );

  const shutdown = async () => {
    logger.info('shutting down');
    relay.stop();
    server.close();
    await bus.close().catch(() => undefined);
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
