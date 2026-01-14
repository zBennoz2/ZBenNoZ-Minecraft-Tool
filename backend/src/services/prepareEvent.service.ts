import { EventEmitter } from 'events';
import { Response } from 'express';

export type PreparePhase =
  | 'needs_auth'
  | 'waiting_for_auth'
  | 'authenticated'
  | 'downloading'
  | 'extracting'
  | 'configured'
  | 'error';

export type PrepareLevel = 'info' | 'warning' | 'error';

export interface PrepareEvent {
  ts: string;
  level: PrepareLevel;
  phase: PreparePhase;
  message: string;
  data?: Record<string, unknown>;
  runId: string;
}

interface PrepareRun {
  runId: string;
  events: PrepareEvent[];
}

type PrepareEventEmitter = EventEmitter & {
  _instanceId?: string;
};

const KEEP_ALIVE_INTERVAL_MS = 25000;
const MAX_EVENTS = 500;

const formatSseEvent = (event: string, data: string) => {
  return `event: ${event}\ndata: ${data}\n\n`;
};

const createRunId = () => {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${now}-${random}`;
};

export class PrepareEventService {
  private emitters = new Map<string, PrepareEventEmitter>();
  private runs = new Map<string, PrepareRun>();

  startRun(instanceId: string): string {
    const runId = createRunId();
    this.runs.set(instanceId, { runId, events: [] });
    const emitter = this.getOrCreateEmitter(instanceId);
    emitter.emit('run', { runId });
    return runId;
  }

  emitEvent(instanceId: string, event: Omit<PrepareEvent, 'runId'>): PrepareEvent {
    const run = this.getOrCreateRun(instanceId);
    const normalized: PrepareEvent = { ...event, runId: run.runId };
    run.events.push(normalized);
    if (run.events.length > MAX_EVENTS) {
      run.events.splice(0, run.events.length - MAX_EVENTS);
    }
    const emitter = this.getOrCreateEmitter(instanceId);
    emitter.emit('prepare', { runId: run.runId, event: normalized });
    return normalized;
  }

  getSnapshot(instanceId: string): { runId: string | null; events: PrepareEvent[] } {
    const run = this.runs.get(instanceId);
    return {
      runId: run?.runId ?? null,
      events: run?.events ?? [],
    };
  }

  subscribe(instanceId: string, res: Response): void {
    const emitter = this.getOrCreateEmitter(instanceId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(formatSseEvent('snapshot', JSON.stringify(this.getSnapshot(instanceId))));

    const sendRun = (payload: { runId: string }) => {
      res.write(formatSseEvent('run', JSON.stringify(payload)));
    };

    const sendEvent = (payload: { runId: string; event: PrepareEvent }) => {
      res.write(formatSseEvent('prepare', JSON.stringify(payload)));
    };

    emitter.on('run', sendRun);
    emitter.on('prepare', sendEvent);

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, KEEP_ALIVE_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(keepAlive);
      emitter.off('run', sendRun);
      emitter.off('prepare', sendEvent);
      this.cleanupEmitter(instanceId, emitter);
      res.end();
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  private getOrCreateRun(instanceId: string): PrepareRun {
    const existing = this.runs.get(instanceId);
    if (existing) return existing;
    const runId = createRunId();
    const created: PrepareRun = { runId, events: [] };
    this.runs.set(instanceId, created);
    return created;
  }

  private getOrCreateEmitter(instanceId: string): PrepareEventEmitter {
    const existing = this.emitters.get(instanceId);
    if (existing) return existing;

    const created: PrepareEventEmitter = new EventEmitter();
    created.setMaxListeners(0);
    created._instanceId = instanceId;
    this.emitters.set(instanceId, created);
    return created;
  }

  private cleanupEmitter(instanceId: string, emitter: PrepareEventEmitter): void {
    if (emitter.listenerCount('run') === 0 && emitter.listenerCount('prepare') === 0) {
      this.emitters.delete(instanceId);
    }
  }
}

export const prepareEventService = new PrepareEventService();
