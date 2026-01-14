import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import extract from 'extract-zip';
import { getInstallerCacheDir, getInstanceDir, getInstanceServerDir } from '../config/paths';
import { DownloadService } from '../core/DownloadService';
import { parseHytaleAuthLine, updateHytaleAuthStatus } from './hytaleAuth.service';
import { PreparePhase, prepareEventService } from './prepareEvent.service';

const HYTALE_DOWNLOADER_ENV = 'HYTALE_DOWNLOADER_URL';
const HYTALE_DOWNLOADER_ARCHIVE = 'hytale-downloader.zip';
const HYTALE_DOWNLOADER_DIR = 'hytale-downloader';
const HYTALE_ARCH_PATTERNS = ['x64', 'amd64', 'x86_64', 'arm64', 'aarch64'];
const HYTALE_ASSETS = 'Assets.zip';
const HYTALE_CREDENTIALS_FILE = '.hytale-downloader-credentials.json';
const DEFAULT_HYTALE_DOWNLOADER_URL = 'https://downloader.hytale.com/hytale-downloader.zip';

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
  patchline?: string;
  skipUpdateCheck?: boolean;
  importServerPath?: string;
  importAssetsPath?: string;
  overwrite?: boolean;
}

export interface HytaleInstallResult {
  serverJar: string;
  assetsPath: string;
}

const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const normalizeCandidate = (value?: string | null) => {
  if (typeof value !== 'string') {
    return { normalized: undefined, received: value, invalid: false } as const;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { normalized: undefined, received: value, invalid: false } as const;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { normalized: undefined, received: value, invalid: true } as const;
    }
  } catch {
    return { normalized: undefined, received: value, invalid: true } as const;
  }
  return { normalized: trimmed, received: value, invalid: false } as const;
};

const describeCandidate = (label: string, value: string | undefined, received: unknown, invalid: boolean) => {
  if (value) {
    return `${label}=set`;
  }
  if (invalid) {
    return `${label}=invalid`;
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
}, options: { allowDefault?: boolean } = {}): {
  url?: string;
  diagnostics: string;
  source?: 'instance' | 'global' | 'env' | 'default';
  invalidSources: string[];
} => {
  const instance = normalizeCandidate(candidates.instance);
  const global = normalizeCandidate(candidates.global);
  const env = normalizeCandidate(candidates.env ?? undefined);

  const invalidSources = [
    instance.invalid ? 'instance' : null,
    global.invalid ? 'global' : null,
    env.invalid ? 'env' : null,
  ].filter(Boolean) as string[];

  const diagnostics = [
    describeCandidate('instance', instance.normalized, instance.received, instance.invalid),
    describeCandidate('global', global.normalized, global.received, global.invalid),
    describeCandidate('env', env.normalized, env.received, env.invalid),
  ];

  let url = instance.normalized ?? global.normalized ?? env.normalized;
  let source: 'instance' | 'global' | 'env' | 'default' | undefined;
  if (instance.normalized) {
    source = 'instance';
  } else if (global.normalized) {
    source = 'global';
  } else if (env.normalized) {
    source = 'env';
  }

  if (!url && options.allowDefault !== false) {
    url = DEFAULT_HYTALE_DOWNLOADER_URL;
    source = 'default';
    diagnostics.push('default=used');
  } else if (options.allowDefault === false) {
    diagnostics.push('default=disabled');
  } else {
    diagnostics.push('default=unused');
  }

  return { url, diagnostics: diagnostics.join(', '), source, invalidSources };
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

const ensureDownloader = async (
  resolvedUrl: {
    url?: string;
    diagnostics: string;
    source?: 'instance' | 'global' | 'env' | 'default';
    invalidSources: string[];
  },
  log?: LogFn,
): Promise<string> => {
  const url = resolvedUrl.url;
  if (!url) {
    const error = new Error('Hytale downloader URL is missing or invalid.');
    (error as Error & { code?: string; diagnostics?: string; invalidSources?: string[] }).code =
      'HYTALE_DOWNLOADER_URL_MISSING';
    (error as Error & { code?: string; diagnostics?: string; invalidSources?: string[] }).diagnostics =
      resolvedUrl.diagnostics;
    (error as Error & { code?: string; diagnostics?: string; invalidSources?: string[] }).invalidSources =
      resolvedUrl.invalidSources;
    throw error;
  }

  if (resolvedUrl.source === 'default') {
    await log?.('Using default Hytale downloader URL. Configure Settings or HYTALE_DOWNLOADER_URL to override.');
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

const listEntries = async (dir: string) => {
  return fs.readdir(dir, { withFileTypes: true });
};

const listJarCandidates = async (rootDir: string): Promise<{ path: string; size: number; name: string }[]> => {
  const entries = await listEntries(rootDir);
  const candidates: { path: string; size: number; name: string }[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...(await listJarCandidates(entryPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.jar')) continue;
    const stat = await fs.stat(entryPath);
    candidates.push({ path: entryPath, size: stat.size, name: entry.name });
  }

  return candidates;
};

const listAssetsCandidates = async (
  rootDir: string,
): Promise<{ path: string; size: number; name: string }[]> => {
  const entries = await listEntries(rootDir);
  const candidates: { path: string; size: number; name: string }[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...(await listAssetsCandidates(entryPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase() !== HYTALE_ASSETS.toLowerCase()) continue;
    const stat = await fs.stat(entryPath);
    candidates.push({ path: entryPath, size: stat.size, name: entry.name });
  }

  return candidates;
};

const pickBestJar = (candidates: { path: string; size: number; name: string }[]) => {
  if (candidates.length === 0) return null;
  const sorted = candidates.sort((a, b) => {
    const aHasServer = a.name.toLowerCase().includes('server');
    const bHasServer = b.name.toLowerCase().includes('server');
    if (aHasServer !== bHasServer) return aHasServer ? -1 : 1;
    if (a.size !== b.size) return b.size - a.size;
    return a.path.localeCompare(b.path);
  });
  return sorted[0];
};

const pickBestAssets = (candidates: { path: string; size: number; name: string }[]) => {
  if (candidates.length === 0) return null;
  const sorted = candidates.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    return a.path.localeCompare(b.path);
  });
  return sorted[0];
};

const findServerJar = async (serverDir: string) => {
  const candidates = await listJarCandidates(serverDir);
  return pickBestJar(candidates);
};

const findAssetsZip = async (serverDir: string) => {
  const candidates = await listAssetsCandidates(serverDir);
  return pickBestAssets(candidates);
};

const ensureEmptyDir = async (dir: string, overwrite: boolean) => {
  await ensureDir(dir);
  const entries = await fs.readdir(dir);
  if (entries.length > 0 && !overwrite) {
    throw new Error(`Server directory is not empty: ${dir}`);
  }
  if (entries.length > 0 && overwrite) {
    await fs.rm(dir, { recursive: true, force: true });
    await ensureDir(dir);
  }
};

const sanitizeCredentialsFile = async (credentialsPath: string, log?: LogFn) => {
  try {
    const stat = await fs.stat(credentialsPath);
    if (!stat.isFile() || stat.size < 5) {
      await log?.('Removing empty or invalid Hytale credentials file.');
      await fs.rm(credentialsPath, { force: true });
      return;
    }
    const raw = await fs.readFile(credentialsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
    if (keys.length === 0) {
      await log?.('Removing incomplete Hytale credentials file.');
      await fs.rm(credentialsPath, { force: true });
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    await log?.(`Failed to validate Hytale credentials file: ${error?.message ?? 'unknown error'}`);
    try {
      await fs.rm(credentialsPath, { force: true });
      await log?.('Removed invalid Hytale credentials file. A new one will be created on next auth.');
    } catch {
      // ignore cleanup failures
    }
  }
};

const parseProgress = (line: string): number | null => {
  const match = line.match(/(\d{1,3})%/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
};

const runDownloaderWithStatus = async (
  instanceId: string,
  command: string,
  args: string[],
  cwd: string,
  log?: LogFn,
  env?: NodeJS.ProcessEnv,
): Promise<void> => {
  await log?.(`Running: ${command} ${args.join(' ')}`);
  let buffer = '';
  let currentCode: string | undefined;
  let lastAuthError: string | undefined;

  const child = spawn(command, args, { cwd, env });

  const emitPrepareEvent = (phase: PreparePhase, message: string, data?: Record<string, unknown>) => {
    prepareEventService.emitEvent(instanceId, {
      ts: new Date().toISOString(),
      level: phase === 'error' ? 'error' : 'info',
      phase,
      message,
      data,
    });
  };

  const handleLine = async (line: string) => {
    if (!line) return;
    await log?.(line);

    const info = parseHytaleAuthLine(line);
    if (info?.authError) {
      lastAuthError = line;
      await updateHytaleAuthStatus(instanceId, {
        state: 'needs_auth',
        authenticated: false,
        message: 'Authentication failed or expired. Retry Prepare to generate a new code.',
        matchedLine: info.matchedLine,
      });
      emitPrepareEvent('error', 'Authentication failed or expired. Retry Prepare to generate a new code.', {
        matchedLine: info.matchedLine,
      });
    }

    if (info?.authenticated) {
      await updateHytaleAuthStatus(instanceId, {
        state: 'authenticated',
        authenticated: true,
        matchedLine: info.matchedLine,
        message: 'Authentication confirmed. Continuing download…',
      });
      emitPrepareEvent('authenticated', 'Authentication confirmed. Continuing download…');
      return;
    }

    if (info?.deviceUrl || info?.userCode) {
      const nextCode = info.userCode ?? currentCode;
      const previousCode = currentCode;
      const nextUrl = info.deviceUrl;
      const isNewCode = Boolean(nextCode && previousCode && nextCode !== previousCode);
      const issuedAt = info.userCode && info.userCode !== previousCode ? new Date().toISOString() : undefined;
      currentCode = nextCode;

      const message = isNewCode
        ? `New authentication code generated. Previous code ${previousCode} is no longer valid.`
        : 'Authentication required. Follow the URL and enter the code.';

      const update = {
        state: info.waiting ? 'waiting_for_auth' : 'needs_auth',
        authenticated: false,
        deviceUrl: nextUrl,
        userCode: nextCode,
        matchedLine: info.matchedLine,
        message,
      } as const;

      await updateHytaleAuthStatus(instanceId, {
        ...update,
        ...(issuedAt ? { codeIssuedAt: issuedAt } : {}),
        ...(info.expiresAt ? { expiresAt: info.expiresAt } : {}),
      });

      if (isNewCode) {
        await log?.(`New authentication code generated. Previous code is no longer valid.`);
      }

      emitPrepareEvent(info.waiting ? 'waiting_for_auth' : 'needs_auth', message, {
        deviceUrl: nextUrl,
        userCode: nextCode,
        previousUserCode: isNewCode ? previousCode : undefined,
        expiresAt: info.expiresAt,
        codeIssuedAt: issuedAt,
      });
    }

    if (info?.waiting) {
      await updateHytaleAuthStatus(instanceId, {
        state: 'waiting_for_auth',
        message: 'Waiting for authentication confirmation…',
      });
      emitPrepareEvent('waiting_for_auth', 'Waiting for authentication confirmation…');
    }

    const progress = parseProgress(line);
    if (progress !== null && /download/i.test(line)) {
      await updateHytaleAuthStatus(instanceId, {
        state: 'downloading',
        authenticated: true,
        progress,
        message: `Downloading game files (${progress}%)`,
      });
      emitPrepareEvent('downloading', `Downloading game files (${progress}%)`, { progress });
    } else if (/download/i.test(line)) {
      await updateHytaleAuthStatus(instanceId, {
        state: 'downloading',
        authenticated: true,
        message: 'Downloading game files…',
      });
      emitPrepareEvent('downloading', 'Downloading game files…');
    }
  };

  const handleChunk = (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      void handleLine(line.trimEnd());
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
    }
  };

  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);

  return new Promise((resolve, reject) => {
    child.once('exit', (code) => {
      if (buffer.trim().length > 0) {
        void handleLine(buffer.trim());
      }
      if (code === 0) {
        resolve();
        return;
      }
      const errorMessage = lastAuthError
        ? `Downloader failed during authentication: ${lastAuthError}`
        : `Command failed with exit code ${code}`;
      reject(new Error(errorMessage));
    });
    child.once('error', (error) => reject(error));
  });
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
): Promise<HytaleInstallResult> => {
  await updateHytaleAuthStatus(instanceId, {
    state: 'idle',
    authenticated: false,
    message: 'Preparing Hytale downloader…',
    progress: undefined,
  }, { clearAuth: true, clearMessage: false });
  prepareEventService.emitEvent(instanceId, {
    ts: new Date().toISOString(),
    level: 'info',
    phase: 'downloading',
    message: 'Preparing Hytale downloader…',
  });
  const resolvedUrl = resolveDownloaderUrl({
    instance: options.downloaderUrl,
    global: options.downloaderUrlCandidates?.global,
    env: options.downloaderUrlCandidates?.env ?? process.env[HYTALE_DOWNLOADER_ENV],
  });
  const downloader = await ensureDownloader(resolvedUrl, log);
  const instanceDir = getInstanceDir(instanceId);
  const serverDir = getInstanceServerDir(instanceId);
  const downloadsDir = path.join(instanceDir, 'downloads');
  await ensureDir(instanceDir);
  await ensureDir(serverDir);
  await ensureDir(downloadsDir);

  const credentialsPath = path.join(instanceDir, HYTALE_CREDENTIALS_FILE);
  await log?.(`Using downloader credentials at ${credentialsPath}`);
  await sanitizeCredentialsFile(credentialsPath, log);

  const gameZipPath = path.join(downloadsDir, 'game.zip');
  const args = ['-download-path', gameZipPath];
  if (options.skipUpdateCheck) {
    args.push('-skip-update-check');
  }
  if (options.patchline) {
    args.push('-patchline', options.patchline);
  }

  const downloaderEnv = {
    ...process.env,
    HOME: instanceDir,
    USERPROFILE: instanceDir,
    XDG_CONFIG_HOME: instanceDir,
  } as NodeJS.ProcessEnv;

  await log?.(`Starting downloader to fetch game.zip into ${gameZipPath}`);
  prepareEventService.emitEvent(instanceId, {
    ts: new Date().toISOString(),
    level: 'info',
    phase: 'downloading',
    message: 'Starting downloader to fetch game.zip…',
    data: { downloadPath: gameZipPath },
  });
  await runDownloaderWithStatus(instanceId, downloader, args, instanceDir, log, downloaderEnv);

  const zipStat = await fs.stat(gameZipPath).catch(() => null);
  if (!zipStat?.isFile()) {
    throw new Error(`Downloader did not create game.zip at ${gameZipPath}`);
  }

  await log?.('Extracting game.zip into instance server directory');
  await updateHytaleAuthStatus(instanceId, {
    state: 'extracting',
    authenticated: true,
    message: 'Extracting server files…',
    progress: undefined,
  });
  prepareEventService.emitEvent(instanceId, {
    ts: new Date().toISOString(),
    level: 'info',
    phase: 'extracting',
    message: 'Extracting server files…',
  });
  await ensureEmptyDir(serverDir, options.overwrite ?? false);
  await extract(gameZipPath, { dir: serverDir });

  const jarCandidate = await findServerJar(serverDir);
  if (!jarCandidate) {
    const candidates = await listJarCandidates(serverDir);
    const files = candidates.map((candidate) => candidate.name).slice(0, 10);
    throw new Error(
      `No server JAR found in extracted Hytale game.zip. Searched ${candidates.length} jar(s) in ${serverDir}. ` +
        `Found: ${files.join(', ') || 'none'}`,
    );
  }

  const assetsCandidate = await findAssetsZip(serverDir);
  if (!assetsCandidate) {
    const entries = await listEntries(serverDir);
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).slice(0, 10);
    throw new Error(
      `Assets.zip not found in extracted Hytale game.zip. Checked ${serverDir}. ` +
        `Top-level files: ${files.join(', ') || 'none'}`,
    );
  }

  await log?.(
    `Detected server jar: ${path.relative(serverDir, jarCandidate.path)} | assets: ${path.relative(
      serverDir,
      assetsCandidate.path,
    )}`,
  );
  return {
    serverJar: path.relative(serverDir, jarCandidate.path),
    assetsPath: path.relative(serverDir, assetsCandidate.path),
  };
};

export const installFromImport = async (
  instanceId: string,
  options: HytaleInstallOptions,
): Promise<HytaleInstallResult> => {
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

  await ensureEmptyDir(serverDir, options.overwrite ?? false);

  await copyServerContents(serverSource, serverDir, options.overwrite ?? false);
  const assetsFileName = path.basename(assetsSource);
  const assetsTarget = path.join(serverDir, assetsFileName);
  await ensureOverwriteAllowed([assetsTarget], options.overwrite ?? false);
  await fs.copyFile(assetsSource, assetsTarget);

  const jarCandidate = await findServerJar(serverDir);
  if (!jarCandidate) {
    throw new Error('No server JAR found in imported Hytale server directory.');
  }

  return {
    serverJar: path.relative(serverDir, jarCandidate.path),
    assetsPath: path.relative(serverDir, assetsTarget),
  };
};

export const detectHytaleServerJar = async (serverDir: string) => {
  const candidate = await findServerJar(serverDir);
  return candidate ? path.relative(serverDir, candidate.path) : null;
};

export const detectHytaleAssetsZip = async (serverDir: string) => {
  const candidate = await findAssetsZip(serverDir);
  return candidate ? path.relative(serverDir, candidate.path) : null;
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
