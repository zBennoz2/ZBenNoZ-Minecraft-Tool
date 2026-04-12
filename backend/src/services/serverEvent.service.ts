import { EventEmitter } from 'events';
import { TaskEventType } from '../core/types';

export interface ServerEventContext {
  player?: string;
  onlineCount?: number;
  maxPlayers?: number | null;
}

export interface ServerEventPayload {
  instanceId: string;
  event: TaskEventType;
  context?: ServerEventContext;
}

class ServerEventService {
  private eventBus = new EventEmitter();

  emit(payload: ServerEventPayload) {
    this.eventBus.emit('server_event', payload);
  }

  onEvent(listener: (payload: ServerEventPayload) => void) {
    this.eventBus.on('server_event', listener);
    return () => this.eventBus.off('server_event', listener);
  }
}

export const serverEventService = new ServerEventService();
