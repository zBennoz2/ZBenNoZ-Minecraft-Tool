import { EventEmitter } from 'events';
import { Response } from 'express';
import { InstanceStatus } from '../core/types';

type InstanceEventEmitter = EventEmitter & {
  _instanceId?: string;
};

const KEEP_ALIVE_INTERVAL_MS = 25000;

const formatSseEvent = (event: string, data: string) => {
  return `event: ${event}\ndata: ${data}\n\n`;
};

export class LogStreamService {
  private emitters = new Map<string, InstanceEventEmitter>();
  private remainders = new Map<string, string>();

  subscribe(instanceId: string, res: Response): void {
    const emitter = this.getOrCreateEmitter(instanceId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendLog = (line: string) => {
      res.write(formatSseEvent('log', line));
    };

    const sendStatus = (status: string) => {
      res.write(formatSseEvent('status', status));
    };

    emitter.on('log', sendLog);
    emitter.on('status', sendStatus);

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, KEEP_ALIVE_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(keepAlive);
      emitter.off('log', sendLog);
      emitter.off('status', sendStatus);
      this.cleanupEmitter(instanceId, emitter);
      res.end();
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  emitLog(instanceId: string, chunk: Buffer | string): void {
    const emitter = this.getOrCreateEmitter(instanceId);
    const previousRemainder = this.remainders.get(instanceId) ?? '';
    const normalized = previousRemainder + chunk.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = normalized.split('\n');
    const remainder = parts.pop() ?? '';
    this.remainders.set(instanceId, remainder);

    for (const line of parts) {
      emitter.emit('log', line);
    }
  }

  emitStatus(instanceId: string, status: InstanceStatus): void {
    this.flushRemainder(instanceId);
    const emitter = this.getOrCreateEmitter(instanceId);
    emitter.emit('status', status);
  }

  flushRemainder(instanceId: string): void {
    const emitter = this.getOrCreateEmitter(instanceId);
    const remainder = this.remainders.get(instanceId);
    if (remainder && remainder.length > 0) {
      emitter.emit('log', remainder);
      this.remainders.set(instanceId, '');
    }
  }

  clearInstance(instanceId: string): void {
    const emitter = this.emitters.get(instanceId);
    if (emitter) {
      emitter.removeAllListeners('log');
      emitter.removeAllListeners('status');
      this.emitters.delete(instanceId);
    }
    this.remainders.delete(instanceId);
  }

  private getOrCreateEmitter(instanceId: string): InstanceEventEmitter {
    const existing = this.emitters.get(instanceId);
    if (existing) return existing;

    const created: InstanceEventEmitter = new EventEmitter();
    created.setMaxListeners(0);
    created._instanceId = instanceId;
    this.emitters.set(instanceId, created);
    return created;
  }

  private cleanupEmitter(instanceId: string, emitter: InstanceEventEmitter): void {
    if (emitter.listenerCount('log') === 0 && emitter.listenerCount('status') === 0) {
      this.emitters.delete(instanceId);
      this.remainders.delete(instanceId);
    }
  }
}

export const logStreamService = new LogStreamService();
