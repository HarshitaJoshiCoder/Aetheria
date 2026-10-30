import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
  });
}
