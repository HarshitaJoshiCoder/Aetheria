import type { EventEnvelope } from '@aetheria/contracts';
import type { Logger } from '@aetheria/common';
import type { EventBus } from './bus.js';

/**
 * Transactional outbox. A service writes its state change and the event into its own
 * database in one transaction; the relay below then publishes pending events. If the
 * broker is down, events wait in the outbox instead of being lost.
 */
export interface OutboxStore {
  /** Pending events in insertion order, at most `limit`. */
  pending(limit: number): Promise<EventEnvelope[]>;
  markPublished(eventId: string): Promise<void>;
}

export interface OutboxRelayOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly store: OutboxStore,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly opts: OutboxRelayOptions = {},
  ) {}

  /** Publish one batch. Stops at the first failure so ordering is preserved. Returns the count sent. */
  async flush(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      for (const event of await this.store.pending(this.opts.batchSize ?? 100)) {
        await this.bus.publish(event);
        await this.store.markPublished(event.id);
        sent++;
      }
    } catch (err) {
      this.logger.warn({ err }, 'outbox relay failed; will retry');
    } finally {
      this.running = false;
    }
    return sent;
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.opts.intervalMs ?? 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
