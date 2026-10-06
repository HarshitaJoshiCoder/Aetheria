import { z } from 'zod';
import { loadEnv } from '@aetheria/common';

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4001),
  MONGO_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  INTERNAL_AUTH_SECRET: z.string().min(32, 'INTERNAL_AUTH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  GOOGLE_CLIENT_ID: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = () => loadEnv(ConfigSchema);
