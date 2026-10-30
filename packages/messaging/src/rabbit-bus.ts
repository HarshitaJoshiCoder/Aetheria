import amqp, { type ConfirmChannel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { EventEnvelope } from '@aetheria/contracts';
import type { Logger } from '@aetheria/common';
import type { EventBus, EventHandler } from './bus.js';

const EXCHANGE = 'aetheria.events';
const DEAD_LETTER_EXCHANGE = 'aetheria.dlx';
const MAX_ATTEMPTS = 5;

/**
 * Topic-exchange event bus. Each consumer gets its own durable queue with a dead-letter
 * queue; a failing message is retried up to MAX_ATTEMPTS times, then parked in `<queue>.dlq`.
 */
export class RabbitBus implements EventBus {
  private constructor(
    private readonly conn: ChannelModel,
    private readonly channel: ConfirmChannel,
    private readonly logger: Logger,
  ) {}

  static async connect(url: string, logger: Logger): Promise<RabbitBus> {
    const conn = await amqp.connect(url);
    const channel = await conn.createConfirmChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    return new RabbitBus(conn, channel, logger);
  }

  async publish(event: EventEnvelope): Promise<void> {
    const body = Buffer.from(JSON.stringify(event));
    await new Promise<void>((resolve, reject) => {
      this.channel.publish(
        EXCHANGE,
        event.type,
        body,
        {
          persistent: true,
          messageId: event.id,
          contentType: 'application/json',
          type: event.type,
        },
        (err: unknown) => (err ? reject(err) : resolve()),
      );
    });
  }

  async subscribe(queue: string, types: string[], handler: EventHandler): Promise<void> {
    const dlq = `${queue}.dlq`;
    await this.channel.assertQueue(dlq, { durable: true });
    await this.channel.bindQueue(dlq, DEAD_LETTER_EXCHANGE, queue);
    await this.channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: DEAD_LETTER_EXCHANGE,
      deadLetterRoutingKey: queue,
    });
    for (const t of types) await this.channel.bindQueue(queue, EXCHANGE, t);
    await this.channel.prefetch(10);

    await this.channel.consume(queue, (msg) => {
      if (msg) void this.handle(queue, msg, handler);
    });
  }

  private async handle(queue: string, msg: ConsumeMessage, handler: EventHandler): Promise<void> {
    const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0) + 1;
    try {
      const event = EventEnvelope.parse(JSON.parse(msg.content.toString())) as EventEnvelope;
      await handler(event);
      this.channel.ack(msg);
    } catch (err) {
      if (attempts >= MAX_ATTEMPTS) {
        this.logger.error({ err, queue, attempts }, 'event failed permanently, dead-lettering');
        this.channel.nack(msg, false, false);
        return;
      }
      this.logger.warn({ err, queue, attempts }, 'event failed, retrying');
      // Re-queue at the back with an incremented attempt counter.
      this.channel.sendToQueue(queue, msg.content, {
        ...msg.properties,
        headers: { ...msg.properties.headers, 'x-attempts': attempts },
      });
      this.channel.ack(msg);
    }
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.conn.close();
  }
}
