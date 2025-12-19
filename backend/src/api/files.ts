import { promises as fs, createReadStream } from 'fs';
import os from 'os';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import multer, { type StorageEngine } from 'multer';
import { InstanceManager } from '../core/InstanceManager';
import { LogService } from '../core/LogService';
import { resolveInstancePath, ResolvedInstancePath } from '../core/SafePath';
import { logStreamService } from '../services/logStream.service';

const router = Router();
const instanceManager = new InstanceManager();
const logService = new LogService();

interface PathAwareRequest extends Request {
  resolvedPath?: ResolvedInstancePath;
  files?: Express.Multer.File[];
}

const logPanel = async (instanceId: string, message: string) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [panel] ${message}\n`;
  await logService.appendLog(instanceId, line);
  logStreamService.emitLog(instanceId, line);
};

const ensureInstance = async (id: string) => {
  const instance = await instanceManager.getInstance(id);
  return instance !== null;
};

const resolvePathOrError = async (req: Request, res: Response): Promise<ResolvedInstancePath | null> => {
  const relPath = typeof req.query.path === 'string' ? req.query.path : '/';
  try {
    return await resolveInstancePath(req.params.id, relPath);
  } catch (error) {
    res.status(400).json({ error: 'Invalid path' });
    return null;
  }
};

const uploadStorage: StorageEngine = multer.diskStorage({
  destination: (
    _req: Request,
    _file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void,
  ) => cb(null, os.tmpdir()),
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage: uploadStorage,
});

router.get('/:id/files', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const resolved = await resolvePathOrError(req, res);
  if (!resolved) return;

  try {
    const stats = await fs.stat(resolved.abs);
    if (!stats.isDirectory()) {
      return res.status(404).json({ error: 'Path is not a directory' });
    }

    const entriesDir = await fs.readdir(resolved.abs, { withFileTypes: true });
    const entries = await Promise.all(
      entriesDir.map(async (dirent) => {
        const entryPath = path.join(resolved.abs, dirent.name);
        const entryStats = await fs.stat(entryPath);
        return {
          name: dirent.name,
          type: dirent.isDirectory() ? 'dir' : 'file',
          size: entryStats.size,
          mtime: entryStats.mtime.toISOString(),
        };
      }),
    );

    await logPanel(id, `files list path=${resolved.rel}`);

    res.json({ id, path: resolved.rel, entries });
  } catch (error) {
    console.error(`Failed to list files for ${id}`, error);
    res.status(500).json({ error: 'Failed to list directory' });
  }
});

router.get('/:id/files/download', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const resolved = await resolvePathOrError(req, res);
  if (!resolved) return;

  try {
    const stats = await fs.stat(resolved.abs);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileName = path.basename(resolved.abs);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await logPanel(id, `files download path=${resolved.rel}`);
    const stream = createReadStream(resolved.abs);
    stream.pipe(res);
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error(`Failed to download file for ${id}`, error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.post('/:id/files/upload', async (req: Request, res: Response, next: NextFunction) => {
  const pathAwareReq = req as PathAwareRequest;
  const { id } = pathAwareReq.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const resolved = await resolvePathOrError(pathAwareReq, res);
  if (!resolved) return;

  try {
    await fs.mkdir(resolved.abs, { recursive: true });
    const stat = await fs.stat(resolved.abs);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Upload path must be a directory' });
    }
  } catch (error) {
    console.error(`Failed to prepare upload directory for ${id}`, error);
    return res.status(500).json({ error: 'Failed to prepare upload directory' });
  }

  pathAwareReq.resolvedPath = resolved;
  next();
}, upload.array('file'), async (req: Request, res: Response) => {
  const pathAwareReq = req as PathAwareRequest;
  const { id } = pathAwareReq.params;
  const overwrite = (req.query.overwrite as string | undefined)?.toLowerCase() === 'true';
  const resolved = pathAwareReq.resolvedPath!;
  const files = (pathAwareReq.files as Express.Multer.File[]) || [];

  const uploaded: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];

  for (const file of files) {
    const targetPath = path.join(resolved.abs, file.originalname);
    const relTarget = path.posix.join(resolved.rel, file.originalname);

    try {
      const exists = await fs
        .stat(targetPath)
        .then((stats) => stats.isFile() || stats.isDirectory())
        .catch(() => false);

      if (exists && !overwrite) {
        skipped.push(relTarget);
        await fs.rm(file.path, { force: true });
        continue;
      }

      await fs.rename(file.path, targetPath);
      if (exists) {
        overwritten.push(relTarget);
        await logPanel(id, `upload path=${resolved.rel} file=${file.originalname} (overwritten)`);
      } else {
        uploaded.push(relTarget);
        await logPanel(id, `upload path=${resolved.rel} file=${file.originalname}`);
      }
    } catch (error) {
      console.error(`Failed to store uploaded file ${file.originalname} for ${id}`, error);
      await fs.rm(file.path, { force: true });
      return res.status(500).json({ error: `Failed to store file ${file.originalname}` });
    }
  }

  res.json({ id, uploaded, skipped, overwritten });
});

router.post('/:id/files/mkdir', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const pathParam = typeof req.body?.path === 'string' ? req.body.path : '/';
  const name = typeof req.body?.name === 'string' ? req.body.name : '';

  if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '..') {
    return res.status(400).json({ error: 'Invalid folder name' });
  }

  const targetPath = path.posix.join(pathParam, name);
  let resolved: ResolvedInstancePath;
  try {
    resolved = await resolveInstancePath(id, targetPath);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  try {
    await fs.mkdir(resolved.abs, { recursive: false });
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      return res.status(409).json({ error: 'Directory already exists' });
    }
    if (error.code === 'ENOENT') {
      return res.status(400).json({ error: 'Parent directory does not exist' });
    }
    console.error(`Failed to create directory for ${id}`, error);
    return res.status(500).json({ error: 'Failed to create directory' });
  }

  await logPanel(id, `files mkdir path=${resolved.rel}`);
  res.status(201).json({ id, path: resolved.rel });
});

router.delete('/:id/files', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const resolved = await resolvePathOrError(req, res);
  if (!resolved) return;

  const recursive = (req.query.recursive as string | undefined)?.toLowerCase() === 'true';

  try {
    const stat = await fs.stat(resolved.abs);
    if (stat.isDirectory()) {
      if (recursive) {
        await fs.rm(resolved.abs, { recursive: true, force: true });
      } else {
        await fs.rmdir(resolved.abs);
      }
    } else {
      await fs.rm(resolved.abs, { force: false });
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File or directory not found' });
    }
    if (error.code === 'ENOTEMPTY') {
      return res.status(409).json({ error: 'Directory is not empty. Use recursive=true to delete.' });
    }
    console.error(`Failed to delete path for ${id}`, error);
    return res.status(500).json({ error: 'Failed to delete path' });
  }

  await logPanel(id, `files delete path=${resolved.rel}${recursive ? ' recursive' : ''}`);
  res.json({ ok: true });
});

router.get('/:id/files/text', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const resolved = await resolvePathOrError(req, res);
  if (!resolved) return;

  const maxBytesRaw = req.query.maxBytes as string | undefined;
  const maxBytes = maxBytesRaw ? parseInt(maxBytesRaw, 10) : 200000;
  if (Number.isNaN(maxBytes) || maxBytes <= 0) {
    return res.status(400).json({ error: 'maxBytes must be a positive integer' });
  }

  try {
    const stat = await fs.stat(resolved.abs);
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const contentBuffer = await fs.readFile(resolved.abs);
    const truncated = contentBuffer.length > maxBytes;
    const content = truncated
      ? contentBuffer.subarray(0, maxBytes).toString('utf-8')
      : contentBuffer.toString('utf-8');

    await logPanel(id, `files read-text path=${resolved.rel}${truncated ? ' (truncated)' : ''}`);

    res.json({ path: resolved.rel, content, truncated });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error(`Failed to read text file for ${id}`, error);
    res.status(500).json({ error: 'Failed to read text file' });
  }
});

router.put('/:id/files/text', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!(await ensureInstance(id))) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const pathParam = typeof req.body?.path === 'string' ? req.body.path : null;
  const content = typeof req.body?.content === 'string' ? req.body.content : null;
  const overwrite = req.body?.overwrite !== false;

  if (!pathParam || content === null) {
    return res.status(400).json({ error: 'path and content are required' });
  }

  let resolved: ResolvedInstancePath;
  try {
    resolved = await resolveInstancePath(id, pathParam);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  try {
    await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
    const flag = overwrite ? 'w' : 'wx';
    await fs.writeFile(resolved.abs, content, { encoding: 'utf-8', flag });
  } catch (error: any) {
    if (!overwrite && error.code === 'EEXIST') {
      return res.status(409).json({ error: 'File already exists and overwrite is false' });
    }
    console.error(`Failed to write text file for ${id}`, error);
    return res.status(500).json({ error: 'Failed to write text file' });
  }

  await logPanel(id, `files write-text path=${resolved.rel}${overwrite ? '' : ' (no-overwrite)'}`);

  res.json({ path: resolved.rel, overwritten: overwrite });
});

export default router;
