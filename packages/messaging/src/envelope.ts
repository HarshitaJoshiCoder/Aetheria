import { randomUUID } from 'node:crypto';
import {
  eventSchemas,
  type EventData,
  type EventEnvelope,
  type EventType,
} from '@aetheria/contracts';

export function createEvent<T extends EventType>(
  type: T,
  data: EventData<T>,
  source: string,
  traceId?: string,
): EventEnvelope<EventData<T>> {
  return {
    id: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    source,
    ...(traceId ? { traceId } : {}),
    data: eventSchemas[type].parse(data) as EventData<T>,
  };
}
