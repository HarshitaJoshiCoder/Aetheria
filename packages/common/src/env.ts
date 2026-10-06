import { z } from 'zod';

/** Parse process.env against a schema and fail fast with a readable message. */
export function loadEnv<S extends z.ZodTypeAny>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
