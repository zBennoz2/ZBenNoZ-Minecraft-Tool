import { Request, Response, Router } from 'express';
import { InstanceManager } from '../core/InstanceManager';
import { LogService } from '../core/LogService';
import { getHytaleAuthStatus, updateHytaleAuthStatus } from '../services/hytaleAuth.service';
import {
  checkDownloaderVersion,
  installFromDownloader,
  verifyJavaMajor,
} from '../services/hytaleInstaller.service';
import { getHytaleVersionSnapshot } from '../services/hytaleVersion.service';
import { startHytaleUpdate } from '../services/hytaleUpdate.service';
import { getJavaRequirement, resolveJavaForInstance } from '../services/java.service';
import { getGlobalHytaleDownloaderUrl } from '../services/globalSettings.service';

const router = Router();
const instanceManager = new InstanceManager();
const logService = new LogService();

const logPanel = async (instanceId: string, message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await logService.appendLog(instanceId, line, 'prepare');
};

const ensureHytaleInstance = async (id: string, res: Response) => {
  const instance = await instanceManager.getInstance(id);
  if (!instance) {
    res.status(404).json({ error: 'Instance not found' });
    return null;
  }
  if (instance.serverType !== 'hytale') {
    res.status(400).json({ error: 'Instance is not a Hytale server' });
    return null;
  }
  return instance;
};

router.get('/:id/hytale/auth', async (req: Request, res: Response) => {
  const instance = await ensureHytaleInstance(req.params.id, res);
  if (!instance) return;

  try {
    const status = await getHytaleAuthStatus(instance.id);
    res.json(status);
  } catch (error) {
    console.error('Failed to read Hytale auth status', error);
    res.status(500).json({ error: 'Failed to read auth status' });
  }
});

router.get('/:id/version', async (req: Request, res: Response) => {
  const instance = await ensureHytaleInstance(req.params.id, res);
  if (!instance) return;

  try {
    const snapshot = await getHytaleVersionSnapshot(instance.id);
    res.json(snapshot);
  } catch (error: any) {
    console.error('Failed to read Hytale version info', error);
    res.status(500).json({ error: error?.message ?? 'Failed to read version info' });
  }
});

router.post('/:id/update', async (req: Request, res: Response) => {
  const instance = await ensureHytaleInstance(req.params.id, res);
  if (!instance) return;

  try {
    const result = await startHytaleUpdate(instance.id);
    if (result.status === 'up_to_date') {
      return res.status(200).json(result);
    }
    if (result.status === 'running') {
      return res.status(202).json(result);
    }
    return res.status(202).json(result);
  } catch (error: any) {
    console.error('Failed to start Hytale update', error);
    return res.status(500).json({ error: error?.message ?? 'Failed to start update' });
  }
});

router.post('/:id/hytale/update/check', async (req: Request, res: Response) => {
  const instance = await ensureHytaleInstance(req.params.id, res);
  if (!instance) return;

  try {
    const globalDownloaderUrl = await getGlobalHytaleDownloaderUrl();
    const version = await checkDownloaderVersion({
      instance: instance.hytale?.install?.downloaderUrl,
      global: globalDownloaderUrl,
      env: process.env.HYTALE_DOWNLOADER_URL,
    });
    res.json({ version });
  } catch (error: any) {
    console.error('Hytale version check failed', error);
    res.status(500).json({ error: error?.message ?? 'Failed to check version' });
  }
});

router.post('/:id/hytale/update', async (req: Request, res: Response) => {
  const instance = await ensureHytaleInstance(req.params.id, res);
  if (!instance) return;

  try {
    const resolved = await resolveJavaForInstance(instance, '', 'hytale');
    if (resolved.status !== 'resolved') {
      return res.status(409).json({
        error: 'NEEDS_JAVA',
        recommendedMajor: resolved.requirement.major,
        requirement: resolved.requirement,
        candidates: resolved.candidates,
        reasons: resolved.reasons,
      });
    }
    const requirement = getJavaRequirement('', 'hytale');
    try {
      await verifyJavaMajor(resolved.javaBin, requirement.major);
    } catch (error: any) {
      return res.status(409).json({
        error: 'NEEDS_JAVA',
        recommendedMajor: requirement.major,
        requirement,
        candidates: resolved.candidates,
        detail: error?.message ?? `Java ${requirement.major} required`,
      });
    }
  } catch (error: any) {
    console.error('Java verification failed for Hytale update', error);
    return res.status(500).json({ error: error?.message ?? 'Java verification failed' });
  }

  try {
    const globalDownloaderUrl = await getGlobalHytaleDownloaderUrl();
    await logPanel(instance.id, 'Updating Hytale server via Downloader CLI');
    const installResult = await installFromDownloader(
      instance.id,
      {
        mode: 'downloader',
        downloaderUrl: instance.hytale?.install?.downloaderUrl,
        downloaderUrlCandidates: {
          global: globalDownloaderUrl,
          env: process.env.HYTALE_DOWNLOADER_URL,
        },
        patchline: instance.hytale?.install?.patchline,
        skipUpdateCheck: instance.hytale?.install?.skipUpdateCheck,
        overwrite: true,
      },
      (message) => logPanel(instance.id, message),
    );
    await instanceManager.updateInstance(instance.id, {
      serverJar: installResult.serverJar,
      hytale: {
        ...(instance.hytale ?? {}),
        assetsPath: installResult.assetsPath,
      },
    });
    await updateHytaleAuthStatus(instance.id, {
      state: 'configured',
      authenticated: true,
      message: 'Hytale server updated successfully.',
      progress: 100,
    });
    await logPanel(instance.id, 'Hytale update finished');
    res.json({ ok: true });
  } catch (error: any) {
    console.error('Hytale update failed', error);
    await logPanel(instance.id, `Hytale update failed: ${error?.message ?? 'unknown error'}`);
    res.status(500).json({ error: error?.message ?? 'Hytale update failed' });
  }
});

export default router;
