import { promises as fs } from 'fs';
import path from 'path';
import { Request, Response, Router } from 'express';
import { InstanceManager } from '../core/InstanceManager';
import { LogService } from '../core/LogService';
import { apply, parse } from '../core/PropertiesFile';
import { getInstanceServerDir } from '../config/paths';
import { logStreamService } from '../services/logStream.service';

const router = Router();
const instanceManager = new InstanceManager();
const logService = new LogService();

const SERVER_PROPERTIES_REL_PATH = path.posix.join('server', 'server.properties');
const SERVER_PROPERTIES_FILE_NAME = 'server.properties';

const logPanel = async (instanceId: string, message: string) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [panel] ${message}\n`;
  await logService.appendLog(instanceId, line);
  logStreamService.emitLog(instanceId, line);
};

const ensureInstanceExists = async (id: string) => {
  const instance = await instanceManager.getInstance(id);
  if (!instance) {
    return null;
  }
  return instance;
};

const getServerPropertiesPath = (instanceId: string) => {
  return path.join(getInstanceServerDir(instanceId), SERVER_PROPERTIES_FILE_NAME);
};

router.get('/:id/server-properties', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instance = await ensureInstanceExists(id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const filePath = getServerPropertiesPath(id);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = parse(raw);
    return res.json({
      id,
      path: SERVER_PROPERTIES_REL_PATH,
      exists: true,
      properties: parsed.props,
      raw,
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.json({ id, path: SERVER_PROPERTIES_REL_PATH, exists: false, properties: {}, raw: '' });
    }
    console.error(`Failed to read server.properties for ${id}`, error);
    return res.status(500).json({ error: 'Failed to read server.properties' });
  }
});

router.put('/:id/server-properties', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instance = await ensureInstanceExists(id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const body = req.body ?? {};

  let newRaw: string | null = null;
  let setValues: Record<string, string> = {};
  let unsetKeys: string[] = [];

  if (typeof body.raw === 'string') {
    newRaw = body.raw;
  } else if (body.set || body.unset) {
    if (body.set && typeof body.set !== 'object') {
      return res.status(400).json({ error: 'set must be an object' });
    }
    if (body.unset && !Array.isArray(body.unset)) {
      return res.status(400).json({ error: 'unset must be an array' });
    }
    setValues = Object.entries(body.set ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {});
    unsetKeys = (body.unset as string[]) ?? [];
  } else {
    return res.status(400).json({ error: 'Provide either raw or set/unset in request body' });
  }

  const filePath = getServerPropertiesPath(id);
  let existingRaw = '';

  try {
    existingRaw = await fs.readFile(filePath, 'utf-8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to read existing server.properties for ${id}`, error);
      return res.status(500).json({ error: 'Failed to read existing server.properties' });
    }
  }

  const contentToWrite = newRaw !== null ? newRaw : apply(existingRaw, setValues, unsetKeys);

  try {
    await fs.mkdir(getInstanceServerDir(id), { recursive: true });
    await fs.writeFile(filePath, contentToWrite, 'utf-8');
  } catch (error) {
    console.error(`Failed to write server.properties for ${id}`, error);
    return res.status(500).json({ error: 'Failed to write server.properties' });
  }

  const finalRaw = contentToWrite;
  const parsed = parse(finalRaw);

  const logParts: string[] = [];
  if (newRaw !== null) {
    logParts.push('properties replace raw');
  } else {
    if (Object.keys(setValues).length > 0) {
      const setFragment = Object.entries(setValues)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
      logParts.push(`properties set ${setFragment}`);
    }
    if (unsetKeys.length > 0) {
      logParts.push(`properties unset ${unsetKeys.join(',')}`);
    }
  }

  if (logParts.length > 0) {
    await logPanel(id, logParts.join(' | '));
  }

  return res.json({
    id,
    path: SERVER_PROPERTIES_REL_PATH,
    exists: true,
    properties: parsed.props,
    raw: finalRaw,
  });
});

export default router;
