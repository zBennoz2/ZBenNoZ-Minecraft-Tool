import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import extract from 'extract-zip';
import { getInstallerCacheDir, getInstanceDir, getInstanceServerDir } from '../config/paths';
import { DownloadService } from '../core/DownloadService';

const HYTALE_DOWNLOADER_ENV = 'HYTALE_DOWNLOADER_URL';
const HYTALE_DOWNLOADER_ARCHIVE = 'hytale-downloader.zip';
const HYTALE_DOWNLOADER_DIR = 'hytale-downloader';
const HYTALE_JAR = 'HytaleServer.jar';
const HYTALE_ASSETS = 'Assets.zip';

type LogFn = (message: string) => Promise<void>;

export type HytaleInstallMode = 'downloader' | 'import';

export interface HytaleInstallOptions {
  mode: HytaleInstallMode;
  downloaderUrl?: string;
  importServerPath?: string;
  importAssetsPath?: string;
  overwrite?: boolean;
}

const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const runCommand = async (command: string, args: string[], cwd: string, log?: LogFn): Promise<void> => {
  await log?.(`Running: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, { cwd });

  child.stdout?.on('data', async (chunk) => log?.(chunk.toString().trimEnd()));
  child.stderr?.on('data', async (chunk) => log?.(chunk.toString().trimEnd()));

  return new Promise((resolve, reject) => {
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    child.once('error', (error) => reject(error));
  });
};

const findDownloaderBinary = async (rootDir: string): Promise<string | null> => {
  const targetName = process.platform === 'win32' ? 'hytale-downloader.exe' : 'hytale-downloader';
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === targetName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nested = await findDownloaderBinary(entryPath);
      if (nested) return nested;
    }
  }
  return null;
};

const ensureDownloader = async (downloaderUrl?: string, log?: LogFn): Promise<string> => {
  const url = downloaderUrl ?? process.env[HYTALE_DOWNLOADER_ENV];
  if (!url) {
    throw new Error(`Missing downloader URL. Set ${HYTALE_DOWNLOADER_ENV} or provide downloaderUrl.`);
  }

  const downloaderRoot = path.join(getInstallerCacheDir(), 'hytale');
  const archivePath = path.join(downloaderRoot, HYTALE_DOWNLOADER_ARCHIVE);
  const extractDir = path.join(downloaderRoot, HYTALE_DOWNLOADER_DIR);

  await ensureDir(downloaderRoot);

  const existingBinary = await findDownloaderBinary(extractDir).catch(() => null);
  if (existingBinary) {
    return existingBinary;
  }

  const downloadService = new DownloadService();
  await log?.(`Downloading Hytale Downloader CLI from ${url}`);
  await downloadService.downloadToFile(url, archivePath);

  await fs.rm(extractDir, { recursive: true, force: true });
  await ensureDir(extractDir);
  await extract(archivePath, { dir: extractDir });

  const binary = await findDownloaderBinary(extractDir);
  if (!binary) {
    throw new Error('Downloader binary not found after extraction.');
  }

  if (process.platform !== 'win32') {
    await fs.chmod(binary, 0o755);
  }

  return binary;
};

const ensureOverwriteAllowed = async (paths: string[], overwrite: boolean) => {
  for (const target of paths) {
    try {
      await fs.access(target);
      if (!overwrite) {
        throw new Error(`File already exists: ${path.basename(target)}`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
};

const copyServerContents = async (sourceDir: string, targetDir: string, overwrite: boolean) => {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true, force: overwrite });
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
};

const placeHytaleFiles = async (sourceRoot: string, targetDir: string, overwrite: boolean) => {
  const serverFolder = path.join(sourceRoot, 'Server');
  const hasServerFolder = await fs
    .access(serverFolder)
    .then(() => true)
    .catch(() => false);

  await ensureDir(targetDir);

  const jarTarget = path.join(targetDir, HYTALE_JAR);
  const assetsTarget = path.join(targetDir, HYTALE_ASSETS);
  await ensureOverwriteAllowed([jarTarget, assetsTarget], overwrite);

  if (hasServerFolder) {
    await copyServerContents(serverFolder, targetDir, overwrite);
  } else {
    await copyServerContents(sourceRoot, targetDir, overwrite);
  }

  const assetsSource = path.join(sourceRoot, HYTALE_ASSETS);
  const assetsExists = await fs
    .access(assetsSource)
    .then(() => true)
    .catch(() => false);
  if (!assetsExists) {
    throw new Error('Assets.zip not found in downloaded archive.');
  }
  await fs.copyFile(assetsSource, assetsTarget);
};

const validateInstall = async (targetDir: string) => {
  const jarPath = path.join(targetDir, HYTALE_JAR);
  const assetsPath = path.join(targetDir, HYTALE_ASSETS);
  await fs.access(jarPath);
  await fs.access(assetsPath);
};

export const verifyJavaMajor = async (javaBin: string, expectedMajor: number) => {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(javaBin, ['--version']);
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', () => {
      const match = output.match(/version\s+"(\d+)/i) ?? output.match(/\bopenjdk\s+(\d+)/i) ?? output.match(/\b(\d+)\.\d+\.\d+/);
      const major = match ? Number.parseInt(match[1], 10) : null;
      if (major === expectedMajor) {
        resolve();
      } else {
        reject(new Error(`Java ${expectedMajor} required, detected ${major ?? 'unknown'}.`));
      }
    });
  });
};

export const installFromDownloader = async (
  instanceId: string,
  options: HytaleInstallOptions,
  log?: LogFn,
): Promise<void> => {
  const downloader = await ensureDownloader(options.downloaderUrl, log);
  const instanceDir = getInstanceDir(instanceId);
  const serverDir = getInstanceServerDir(instanceId);
  await ensureDir(instanceDir);
  await ensureDir(serverDir);

  const workDir = await fs.mkdtemp(path.join(instanceDir, 'hytale-download-'));
  const gameZipPath = path.join(workDir, 'game.zip');

  await runCommand(downloader, ['-download-path', gameZipPath], workDir, log);

  const extractDir = path.join(workDir, 'extract');
  await ensureDir(extractDir);
  await extract(gameZipPath, { dir: extractDir });

  await placeHytaleFiles(extractDir, serverDir, options.overwrite ?? false);
  await validateInstall(serverDir);
};

export const installFromImport = async (
  instanceId: string,
  options: HytaleInstallOptions,
): Promise<void> => {
  const serverDir = getInstanceServerDir(instanceId);
  await ensureDir(serverDir);

  if (!options.importServerPath || !options.importAssetsPath) {
    throw new Error('Import paths are required for manual install.');
  }

  const serverSource = path.resolve(options.importServerPath);
  const assetsSource = path.resolve(options.importAssetsPath);

  const serverStat = await fs.stat(serverSource);
  if (!serverStat.isDirectory()) {
    throw new Error('Import server path must be a directory.');
  }

  const assetsStat = await fs.stat(assetsSource);
  if (!assetsStat.isFile()) {
    throw new Error('Import assets path must be a file.');
  }

  await ensureOverwriteAllowed([path.join(serverDir, HYTALE_JAR), path.join(serverDir, HYTALE_ASSETS)], options.overwrite ?? false);

  await copyServerContents(serverSource, serverDir, options.overwrite ?? false);
  await fs.copyFile(assetsSource, path.join(serverDir, HYTALE_ASSETS));

  await validateInstall(serverDir);
};

export const checkDownloaderVersion = async (downloaderUrl?: string, log?: LogFn): Promise<string> => {
  const downloader = await ensureDownloader(downloaderUrl, log);
  const workDir = path.dirname(downloader);
  let output = '';

  await new Promise<void>((resolve, reject) => {
    const child = spawn(downloader, ['-print-version'], { cwd: workDir });
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Version check failed with exit code ${code}`));
    });
  });

  const normalized = output.trim();
  if (!normalized) {
    throw new Error('Downloader did not report a version.');
  }
  return normalized;
};
