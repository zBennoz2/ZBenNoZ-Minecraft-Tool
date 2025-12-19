import { promises as fs } from 'fs';
import {
  getInstanceLatestLogPath,
  getInstanceLogsDir,
  getInstancePrepareLogPath,
} from '../config/paths';

type LogSource = 'server' | 'prepare';

const getPathForSource = (id: string, source: LogSource) => {
  return source === 'prepare' ? getInstancePrepareLogPath(id) : getInstanceLatestLogPath(id);
};

export class LogService {
  async appendLog(instanceId: string, chunk: string, source: LogSource = 'server'): Promise<void> {
    const dir = getInstanceLogsDir(instanceId);
    const filePath = getPathForSource(instanceId, source);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(filePath, chunk, 'utf-8');
  }

  async readTail(instanceId: string, lines: number, source: LogSource = 'server'): Promise<string> {
    const filePath = getPathForSource(instanceId, source);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const splitted = content.split(/\r?\n/);
      const tail = splitted.slice(-lines).join('\n');
      return tail;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }
}
