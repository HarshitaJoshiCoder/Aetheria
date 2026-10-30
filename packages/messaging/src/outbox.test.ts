import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@aetheria/contracts';
import { createLogger } from '@aetheria/common';
import { createEvent } from './envelope.js';
import { InMemoryBus } from './memory-bus.js';
import { OutboxRelay, type OutboxStore } from './outbox.js';

class ArrayStore implements OutboxStore {
  constructor(public events: { event: EventEnvelope; published: boolean }[] = []) {}
  async pending(limit: number) {
    return this.events
      .filter((e) => !e.published)
      .slice(0, limit)
      .map((e) => e.event);
  }
  async markPublished(id: string) {
    const rec = this.events.find((e) => e.event.id === id);
    if (rec) rec.published = true;
  }
}

const logger = createLogger('test');
const ev = () =>
  createEvent(
    'user.registered',
    { userId: 'u1', email: 'a@b.co', name: 'A', role: 'customer' },
    'test',
  );

describe('OutboxRelay', () => {
  it('publishes pending events once and marks them published', async () => {
    const store = new ArrayStore([
      { event: ev(), published: false },
      { event: ev(), published: false },
    ]);
    const bus = new InMemoryBus();
    const relay = new OutboxRelay(store, bus, logger);
    expect(await relay.flush()).toBe(2);
    expect(await relay.flush()).toBe(0);
    expect(bus.published).toHaveLength(2);
  });

  it('keeps events pending when the bus fails', async () => {
    const store = new ArrayStore([{ event: ev(), published: false }]);
    const bus = new InMemoryBus();
    bus.publish = async () => {
      throw new Error('broker down');
    };
    const relay = new OutboxRelay(store, bus, logger);
    expect(await relay.flush()).toBe(0);
    expect(await store.pending(10)).toHaveLength(1);
  });
});

describe('createEvent', () => {
  it('rejects data that does not match the event schema', () => {
    expect(() =>
      // @ts-expect-error missing fields on purpose
      createEvent('user.registered', { userId: 'u1' }, 'test'),
    ).toThrow();
  });
});
