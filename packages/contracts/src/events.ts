import { z } from 'zod';
import { Role } from './auth.js';

/** Every event on the bus is wrapped in this envelope. `id` is used for consumer idempotency. */
export const EventEnvelope = z.object({
  id: z.string().uuid(),
  type: z.string(),
  occurredAt: z.string().datetime(),
  source: z.string(),
  traceId: z.string().optional(),
  data: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelope>, 'data'> & { data: T };

export const UserRegistered = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: Role,
});
export type UserRegistered = z.infer<typeof UserRegistered>;

/** Registry of event types to payload schemas; consumers validate against it. */
export const eventSchemas = {
  'user.registered': UserRegistered,
} as const;
export type EventType = keyof typeof eventSchemas;
export type EventData<T extends EventType> = z.infer<(typeof eventSchemas)[T]>;
