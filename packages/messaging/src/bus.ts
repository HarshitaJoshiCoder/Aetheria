import type { EventEnvelope } from '@aetheria/contracts';

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventBus {
  publish(event: EventEnvelope): Promise<void>;
  /** Bind a durable queue named `queue` to the given event types and consume it. */
  subscribe(queue: string, types: string[], handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}
