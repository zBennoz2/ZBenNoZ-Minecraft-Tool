import { ChildProcess } from 'child_process';
import { LogService } from '../core/LogService';
import { logStreamService } from '../services/logStream.service';
import { recordActivity } from '../services/runtimeState.service';

const forwardLog = (instanceId: string, logService: LogService) => (chunk: Buffer | string) => {
  const text = chunk.toString();
  logStreamService.emitLog(instanceId, text);
  recordActivity(instanceId);
  logService
    .appendLog(instanceId, text)
    .catch((error) => console.error(`Failed to append log for instance ${instanceId}`, error));
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
    logStreamService.flushRemainder(instanceId);
  };

  child.once('exit', cleanup);
  child.once('close', cleanup);
};
