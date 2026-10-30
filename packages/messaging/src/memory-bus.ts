import type { EventEnvelope } from '@aetheria/contracts';
import type { EventBus, EventHandler } from './bus.js';

/** In-process bus for tests and local scripts. Delivers synchronously to matching subscribers. */
export class InMemoryBus implements EventBus {
  readonly published: EventEnvelope[] = [];
  private subs: { types: string[]; handler: EventHandler }[] = [];

  async publish(event: EventEnvelope): Promise<void> {
    this.published.push(event);
    for (const s of this.subs) {
      if (s.types.includes(event.type)) await s.handler(event);
    }
  }

  async subscribe(_queue: string, types: string[], handler: EventHandler): Promise<void> {
    this.subs.push({ types, handler });
  }

  async close(): Promise<void> {
    this.subs = [];
  }
}
