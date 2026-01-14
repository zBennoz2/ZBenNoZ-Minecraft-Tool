import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import extract from 'extract-zip';
import { getInstallerCacheDir, getInstanceDir, getInstanceServerDir } from '../config/paths';
import { DownloadService } from '../core/DownloadService';

const HYTALE_DOWNLOADER_ENV = 'HYTALE_DOWNLOADER_URL';
const HYTALE_DOWNLOADER_ARCHIVE = 'hytale-downloader.zip';
const HYTALE_DOWNLOADER_DIR = 'hytale-downloader';
const HYTALE_ARCH_PATTERNS = ['x64', 'amd64', 'x86_64', 'arm64', 'aarch64'];
const HYTALE_JAR = 'HytaleServer.jar';
const HYTALE_ASSETS = 'Assets.zip';

type LogFn = (message: string) => Promise<void>;

export type HytaleInstallMode = 'downloader' | 'import';

export interface HytaleInstallOptions {
  mode: HytaleInstallMode;
  downloaderUrl?: string;
  downloaderUrlCandidates?: {
    instance?: string | null;
    global?: string | null;
    env?: string | null;
  };
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

const normalizeCandidate = (value?: string | null) => {
  if (typeof value !== 'string') {
    return { normalized: undefined, received: value } as const;
  }
  const trimmed = value.trim();
  return { normalized: trimmed.length > 0 ? trimmed : undefined, received: value } as const;
};

const describeCandidate = (label: string, value: string | undefined, received: unknown) => {
  if (value) {
    return `${label}=set`;
  }
  if (typeof received === 'string') {
    return `${label}=empty-string`;
  }
  return `${label}=undefined`;
};

export const resolveDownloaderUrl = (candidates: {
  instance?: string | null;
  global?: string | null;
  env?: string | null;
}): { url?: string; diagnostics: string } => {
  const instance = normalizeCandidate(candidates.instance);
  const global = normalizeCandidate(candidates.global);
  const env = normalizeCandidate(candidates.env ?? undefined);

  const diagnostics = [
    describeCandidate('instance', instance.normalized, instance.received),
    describeCandidate('global', global.normalized, global.received),
    describeCandidate('env', env.normalized, env.received),
  ].join(', ');

  const url = instance.normalized ?? global.normalized ?? env.normalized;
  return { url, diagnostics };
};

const isLikelyDownloaderName = (name: string) => {
  const lower = name.toLowerCase();
  return lower.includes('hytale') || lower.includes('downloader');
};

const isLikelyBinary = (name: string) => {
  if (process.platform === 'win32') {
    return name.toLowerCase().endsWith('.exe');
  }
  return !name.includes('.');
};

const scoreBinaryCandidate = (name: string) => {
  const lower = name.toLowerCase();
  let score = 0;
  if (isLikelyDownloaderName(lower)) score += 5;
  if (lower.includes('downloader')) score += 3;
  if (lower.includes('hytale')) score += 3;
  if (HYTALE_ARCH_PATTERNS.some((arch) => lower.includes(arch))) score += 1;
  return score;
};

const collectDownloaderCandidates = async (rootDir: string): Promise<{ path: string; score: number }[]> => {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const candidates: { path: string; score: number }[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...(await collectDownloaderCandidates(entryPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isLikelyBinary(entry.name)) continue;

    const score = scoreBinaryCandidate(entry.name);
    if (score > 0) {
      candidates.push({ path: entryPath, score });
    }
  }

  return candidates;
};

const findDownloaderBinary = async (rootDir: string): Promise<string | null> => {
  const candidates = await collectDownloaderCandidates(rootDir);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].path;
};

const listTopLevelEntries = async (dir: string, limit = 10) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.slice(0, limit).map((entry) => entry.name);
  } catch {
    return [];
  }
};

const ensureDownloader = async (resolvedUrl: { url?: string; diagnostics: string }, log?: LogFn): Promise<string> => {
  const url = resolvedUrl.url;
  if (!url) {
    throw new Error(`Missing downloader URL. Checked sources: ${resolvedUrl.diagnostics}.`);
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
    const topLevel = await listTopLevelEntries(extractDir);
    const searched = ['hytale', 'downloader', ...HYTALE_ARCH_PATTERNS];
    throw new Error(
      `Downloader binary not found after extraction. Extract path: ${extractDir}. ` +
        `Top-level entries: ${topLevel.join(', ') || 'none'}. ` +
        `Searched patterns: ${searched.join(', ')}`,
    );
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
  const resolvedUrl = resolveDownloaderUrl({
    instance: options.downloaderUrl,
    global: options.downloaderUrlCandidates?.global,
    env: options.downloaderUrlCandidates?.env ?? process.env[HYTALE_DOWNLOADER_ENV],
  });
  const downloader = await ensureDownloader(resolvedUrl, log);
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

export const checkDownloaderVersion = async (
  candidates: {
    instance?: string | null;
    global?: string | null;
    env?: string | null;
  },
  log?: LogFn,
): Promise<string> => {
  const resolvedUrl = resolveDownloaderUrl({
    instance: candidates.instance,
    global: candidates.global,
    env: candidates.env ?? process.env[HYTALE_DOWNLOADER_ENV],
  });
  const downloader = await ensureDownloader(resolvedUrl, log);
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
