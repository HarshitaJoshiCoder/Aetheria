import { z } from 'zod';
import { loadEnv } from '@aetheria/common';

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  JWT_ACCESS_SECRET: z.string().min(32),
  INTERNAL_AUTH_SECRET: z.string().min(32),
  /** Comma-separated list of browser origins allowed to call the API. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  AUTH_SERVICE_URL: z.string().url(),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(10_000),
});
export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = () => loadEnv(ConfigSchema);
