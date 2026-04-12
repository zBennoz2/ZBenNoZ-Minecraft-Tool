import { ChildProcess } from 'child_process';
import { LogService } from '../core/LogService';
import { logStreamService } from '../services/logStream.service';
import { recordActivity } from '../services/runtimeState.service';
import { serverEventService } from '../services/serverEvent.service';

const onlineCounts = new Map<string, number>();

const trackPlayerEvents = (instanceId: string, text: string) => {
  const lines = text.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const joined = line.match(/]:\s*([^\s]+) joined the game/i);
    if (joined) {
      const previous = onlineCounts.get(instanceId) ?? 0;
      const next = previous + 1;
      onlineCounts.set(instanceId, next);
      const player = joined[1];

      serverEventService.emit({
        instanceId,
        event: 'PlayerJoin',
        context: { player, onlineCount: next },
      });

      if (previous === 0) {
        serverEventService.emit({
          instanceId,
          event: 'FirstPlayerJoined',
          context: { player, onlineCount: next },
        });
      }
      continue;
    }

    const left = line.match(/]:\s*([^\s]+) left the game/i);
    if (left) {
      const previous = onlineCounts.get(instanceId) ?? 0;
      const next = Math.max(0, previous - 1);
      onlineCounts.set(instanceId, next);
      const player = left[1];

      serverEventService.emit({
        instanceId,
        event: 'PlayerLeave',
        context: { player, onlineCount: next },
      });

      if (next === 0) {
        serverEventService.emit({
          instanceId,
          event: 'LastPlayerLeft',
          context: { player, onlineCount: 0 },
        });
        serverEventService.emit({
          instanceId,
          event: 'ServerEmpty',
          context: { player, onlineCount: 0 },
        });
      }
    }
  }
};

const forwardLog = (instanceId: string, logService: LogService) => (chunk: Buffer | string) => {
  const text = chunk.toString();
  logStreamService.emitLog(instanceId, text);
  recordActivity(instanceId);
  trackPlayerEvents(instanceId, text);
  logService
    .appendLog(instanceId, text)
    .catch((error) => console.error(`Failed to append log for instance ${instanceId}`, error));
};

export const resetTrackedPlayers = (instanceId: string) => {
  onlineCounts.set(instanceId, 0);
};

export const attachProcessLogStreams = (
  instanceId: string,
  child: ChildProcess,
  logService: LogService,
): void => {
  const handler = forwardLog(instanceId, logService);

  child.stdout?.on('data', handler);
  child.stderr?.on('data', handler);

  const cleanup = () => {
    child.stdout?.off('data', handler);
    child.stderr?.off('data', handler);
    resetTrackedPlayers(instanceId);
    logStreamService.flushRemainder(instanceId);
  };

  child.once('exit', cleanup);
  child.once('close', cleanup);
};
