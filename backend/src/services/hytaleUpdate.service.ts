import { promises as fs } from 'fs';
import path from 'path';
import extract from 'extract-zip';
import { InstanceManager } from '../core/InstanceManager';
import { LogService } from '../core/LogService';
import { DownloadService } from '../core/DownloadService';
import { getInstanceDir, getInstanceServerDir } from '../config/paths';
import { instanceActionService } from './instanceActions.service';
import { jobService } from './job.service';
import { detectHytaleAssetsZip, detectHytaleServerJar } from './hytaleInstaller.service';
import {
  compareSemver,
  getHytaleVersionSnapshot,
  getLatestHytaleRelease,
  getInstalledHytaleVersion,
  normalizeSemver,
} from './hytaleVersion.service';

export type HytaleUpdateStartResult =
  | { status: 'up_to_date'; installed: string | null; latest: string | null }
  | { status: 'started'; jobId: string; installed: string | null; latest: string }
  | { status: 'running'; jobId: string };

const instanceManager = new InstanceManager();
const logService = new LogService();
const downloadService = new DownloadService();
const activeUpdateJobs = new Map<string, string>();

const UPDATE_PHASES = {
  downloading: 'DOWNLOADING',
  installing: 'INSTALLING',
  restarting: 'RESTARTING',
  done: 'DONE',
  error: 'ERROR',
} as const;

const logUpdate = async (instanceId: string, message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await logService.appendLog(instanceId, line, 'prepare');
};

const toPosixPath = (value: string) => value.split(path.sep).join(path.posix.sep);

const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const fileExists = async (filePath: string) => {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const updateJob = (jobId: string, partial: Parameters<typeof jobService.updateJob>[1]) => {
  jobService.updateJob(jobId, partial);
};

const writeVersionFiles = async (serverDir: string, versionDir: string, version: string) => {
  await fs.writeFile(path.join(serverDir, 'version.txt'), `${version}\n`, 'utf-8');
  await fs.writeFile(path.join(versionDir, 'version.txt'), `${version}\n`, 'utf-8');
};

type SymlinkHint = 'file' | 'dir' | 'junction';

const createSymlink = async (target: string, linkPath: string) => {
  await fs.rm(linkPath, { recursive: true, force: true });
  // Node's SymlinkType type is not exported in older @types/node, so we use string literals.
  const type: SymlinkHint | undefined = process.platform === 'win32' ? 'junction' : undefined;
  await fs.symlink(target, linkPath, type);
};

export const startHytaleUpdate = async (instanceId: string): Promise<HytaleUpdateStartResult> => {
  const existingJob = activeUpdateJobs.get(instanceId);
  if (existingJob) {
    return { status: 'running', jobId: existingJob };
  }

  const snapshot = await getHytaleVersionSnapshot(instanceId);
  if (!snapshot.latest) {
    throw new Error('Latest Hytale version unavailable. Configure HYTALE_RELEASE_MANIFEST_URL.');
  }
  if (snapshot.installed && snapshot.latest) {
    try {
      if (compareSemver(snapshot.installed, snapshot.latest) >= 0) {
        return { status: 'up_to_date', installed: snapshot.installed, latest: snapshot.latest };
      }
    } catch {
      // Continue with update attempt if semver compare fails.
    }
  }

  const job = jobService.createJob();
  activeUpdateJobs.set(instanceId, job.id);
  void runHytaleUpdate(instanceId, job.id).finally(() => {
    activeUpdateJobs.delete(instanceId);
  });

  return { status: 'started', jobId: job.id, installed: snapshot.installed, latest: snapshot.latest };
};

const runHytaleUpdate = async (instanceId: string, jobId: string) => {
  try {
    const instance = await instanceManager.getInstance(instanceId);
    if (!instance) {
      updateJob(jobId, { status: 'failed', phase: UPDATE_PHASES.error, error: 'Instance not found' });
      return;
    }
    if (instance.serverType !== 'hytale') {
      updateJob(jobId, { status: 'failed', phase: UPDATE_PHASES.error, error: 'Instance is not Hytale' });
      return;
    }

    updateJob(jobId, { status: 'running', progress: 5, message: 'Checking versions' });
    const release = await getLatestHytaleRelease();
    const latestVersion = normalizeSemver(release.version) ?? release.version;
    const installedVersion = normalizeSemver(await getInstalledHytaleVersion(instanceId));

    if (installedVersion) {
      try {
        if (compareSemver(installedVersion, latestVersion) >= 0) {
          updateJob(jobId, {
            status: 'completed',
            phase: UPDATE_PHASES.done,
            progress: 100,
            message: 'Hytale already up to date',
          });
          return;
        }
      } catch {
        // If compare fails, proceed with update.
      }
    }

    const serverDir = getInstanceServerDir(instanceId);
    const versionsDir = path.join(serverDir, 'versions');
    const versionDir = path.join(versionsDir, latestVersion);
    const currentLink = path.join(serverDir, 'current');
    const backupDir = path.join(serverDir, `backup-${Date.now()}`);

    const status = await instanceActionService.status(instanceId).catch(() => ({ status: 'unknown' }));
    const wasRunning = status.status === 'running';

    if (wasRunning) {
      updateJob(jobId, { message: 'Stopping server', progress: 10, phase: UPDATE_PHASES.restarting });
      await logUpdate(instanceId, 'Stopping Hytale server before update');
      await instanceActionService.stop(instanceId);
    }

    await ensureDir(versionsDir);

    let serverJarRelative = '';
    let assetsRelative = '';

    if (!(await fileExists(versionDir))) {
      updateJob(jobId, { message: 'Downloading Hytale update', progress: 20, phase: UPDATE_PHASES.downloading });
      await logUpdate(instanceId, `Downloading Hytale ${latestVersion} from ${release.serverUrl}`);

      const tempRoot = path.join(getInstanceDir(instanceId), 'tmp');
      const tempDir = path.join(tempRoot, `hytale-update-${jobId}`);
      const zipPath = path.join(tempDir, 'server.zip');

      await fs.rm(tempDir, { recursive: true, force: true });
      await ensureDir(tempDir);

      await downloadService.downloadToFile(release.serverUrl, zipPath);

      if (release.sha256) {
        const hash = await downloadService.sha256File(zipPath);
        if (hash !== release.sha256) {
          throw new Error(`SHA256 mismatch for Hytale ${latestVersion} (expected ${release.sha256}, got ${hash}).`);
        }
      }

      updateJob(jobId, { message: 'Installing server files', progress: 55, phase: UPDATE_PHASES.installing });
      await extract(zipPath, { dir: tempDir });

      const jarCandidate = await detectHytaleServerJar(tempDir);
      const assetsCandidate = await detectHytaleAssetsZip(tempDir);
      if (!jarCandidate || !assetsCandidate) {
        throw new Error('Downloaded server bundle is missing a server JAR or Assets.zip.');
      }

      serverJarRelative = jarCandidate;
      assetsRelative = assetsCandidate;

      await fs.rm(zipPath, { force: true });
      await fs.rm(versionDir, { recursive: true, force: true });
      await fs.rename(tempDir, versionDir);
    } else {
      const jarCandidate = await detectHytaleServerJar(versionDir);
      const assetsCandidate = await detectHytaleAssetsZip(versionDir);
      if (!jarCandidate || !assetsCandidate) {
        throw new Error('Existing version directory is missing required server files.');
      }
      serverJarRelative = jarCandidate;
      assetsRelative = assetsCandidate;
    }

    await writeVersionFiles(serverDir, versionDir, latestVersion);

    const currentStat = await fs.lstat(currentLink).catch(() => null);
    const previousTarget = currentStat?.isSymbolicLink() ? await fs.readlink(currentLink) : null;

    if (!previousTarget) {
      const existingJar = await detectHytaleServerJar(serverDir);
      const existingAssets = await detectHytaleAssetsZip(serverDir);
      if (existingJar || existingAssets) {
        await ensureDir(backupDir);
        if (existingJar) {
          await fs.copyFile(path.join(serverDir, existingJar), path.join(backupDir, path.basename(existingJar)));
        }
        if (existingAssets) {
          await fs.copyFile(path.join(serverDir, existingAssets), path.join(backupDir, path.basename(existingAssets)));
        }
        await logUpdate(instanceId, `Backed up previous server binaries to ${backupDir}`);
      }
    }

    await createSymlink(versionDir, currentLink);

    const normalizedJar = toPosixPath(serverJarRelative);
    const normalizedAssets = toPosixPath(assetsRelative);
    await instanceManager.updateInstance(instanceId, {
      serverJar: path.posix.join('current', normalizedJar),
      hytale: {
        ...(instance.hytale ?? {}),
        assetsPath: path.posix.join('current', normalizedAssets),
        install: {
          ...(instance.hytale?.install ?? {}),
          installedVersion: latestVersion,
        },
      },
    });

    updateJob(jobId, { message: 'Finalizing update', progress: 85, phase: UPDATE_PHASES.installing });
    await logUpdate(instanceId, `Installed Hytale ${latestVersion}`);

    if (wasRunning) {
      updateJob(jobId, { message: 'Restarting server', progress: 92, phase: UPDATE_PHASES.restarting });
      await instanceActionService.start(instanceId);
    }

    updateJob(jobId, {
      status: 'completed',
      progress: 100,
      phase: UPDATE_PHASES.done,
      message: 'Hytale update complete',
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Update failed';
    updateJob(jobId, { status: 'failed', progress: 100, phase: UPDATE_PHASES.error, error: message });
    await logUpdate(instanceId, `Hytale update failed: ${message}`);
  }
};
