import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { Request, Response, Router } from 'express';
import { getInstanceJarPath, getInstanceServerDir, getInstallerCacheDir } from '../config/paths';
import { CatalogService } from '../core/CatalogService';
import { DownloadService } from '../core/DownloadService';
import { InstanceManager } from '../core/InstanceManager';
import { LogService } from '../core/LogService';
import { logStreamService } from '../services/logStream.service';
import { LoaderType, ServerType } from '../core/types';
import { getJavaRequirement, resolveJavaForInstance } from '../services/java.service';
import { InstanceActionError } from '../core/InstanceActionError';
import {
  HytaleInstallMode,
  installFromDownloader,
  installFromImport,
  verifyJavaMajor,
} from '../services/hytaleInstaller.service';
import { getGlobalHytaleDownloaderUrl } from '../services/globalSettings.service';

const router = Router();
const instanceManager = new InstanceManager();
const downloadService = new DownloadService();
const catalogService = new CatalogService();
const logService = new LogService();

const FORGE_MAVEN_BASE = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_MAVEN_BASE = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const FABRIC_MAVEN_BASE = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer';
const USER_AGENT = 'MinecraftPanel/0.1 (+https://example.local)';

const allowedTypes: ServerType[] = ['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'hytale'];

type PrepareError = { status: number; message: string; detail?: string };

const ensureDir = async (dirPath: string) => fs.mkdir(dirPath, { recursive: true });

const logPrepare = async (instanceId: string, message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await logService.appendLog(instanceId, line, 'prepare');
  await logService.appendLog(instanceId, line, 'server');
  logStreamService.emitLog(instanceId, line);
};

const runCommand = async (
  instanceId: string,
  command: string,
  args: string[],
  cwd: string,
): Promise<void> => {
  await logPrepare(instanceId, `Running: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, { cwd });

  child.stdout?.on('data', async (chunk) => logPrepare(instanceId, chunk.toString().trimEnd()));
  child.stderr?.on('data', async (chunk) => logPrepare(instanceId, chunk.toString().trimEnd()));

  return new Promise((resolve, reject) => {
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject({ status: 500, message: `Command failed with exit code ${code}` });
      }
    });
    child.once('error', (error) => reject({ status: 500, message: 'Failed to spawn process', detail: error.message }));
  });
};

const ensureOverwriteAllowed = async (pathsToCheck: string[], overwrite: boolean) => {
  for (const checkPath of pathsToCheck) {
    try {
      await fs.access(checkPath);
      if (!overwrite) {
        const fileName = path.basename(checkPath);
        throw { status: 409, message: `${fileName} already exists for this instance` } as PrepareError;
      }
    } catch (error: any) {
      if (error?.status) throw error;
      if (error.code !== 'ENOENT') {
        throw { status: 500, message: 'Failed to check existing files', detail: error.message } as PrepareError;
      }
    }
  }
};

const downloadIfMissing = async (
  url: string,
  destPath: string,
  headers?: Record<string, string>,
): Promise<void> => {
  try {
    await fs.access(destPath);
    return;
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await downloadService.downloadToFile(url, destPath, headers);
};

const prepareVanillaOrPaper = async (
  instanceId: string,
  serverType: 'vanilla' | 'paper',
  minecraftVersion: string,
  overwrite: boolean,
) => {
  const jarFileName = 'server.jar';
  const jarPath = getInstanceJarPath(instanceId, jarFileName);

  await ensureDir(getInstanceServerDir(instanceId));

  await ensureOverwriteAllowed([jarPath], overwrite);

  if (serverType === 'vanilla') {
    await logPrepare(instanceId, `Downloading Vanilla server ${minecraftVersion}`);
    await downloadService.downloadVanillaServerJar(minecraftVersion, jarPath);
  } else {
    await logPrepare(instanceId, `Downloading Paper server ${minecraftVersion}`);
    await downloadService.downloadPaperServerJar(minecraftVersion, jarPath);
  }

  await instanceManager.updateInstance(instanceId, {
    serverType,
    minecraftVersion,
    serverJar: jarFileName,
    startup: { mode: 'jar' },
  });
};

const resolveLoaderVersion = async (
  minecraftVersion: string,
  loaderType: LoaderType,
  providedVersion?: string,
): Promise<string> => {
  if (providedVersion) return providedVersion;

  if (loaderType === 'fabric') {
    const catalog = await catalogService.getFabricVersions();
    const list = catalog.loaderVersionsByGame[minecraftVersion];
    if (list?.length) return list[0];
    throw { status: 400, message: `No Fabric loader found for ${minecraftVersion}` } as PrepareError;
  }

  if (loaderType === 'forge') {
    const catalog = await catalogService.getForgeVersions();
    const entry = catalog.byMinecraft[minecraftVersion];
    if (entry?.recommended) return entry.recommended;
    if (entry?.latest) return entry.latest;
    throw { status: 400, message: `No Forge version found for ${minecraftVersion}` } as PrepareError;
  }

  const neoforge = await catalogService.getNeoForgeVersions();
  if (neoforge.latest) return neoforge.latest;
  throw { status: 400, message: 'No NeoForge versions available' } as PrepareError;
};

const prepareFabric = async (
  instanceId: string,
  minecraftVersion: string,
  loaderVersion: string,
  overwrite: boolean,
  javaBin: string,
) => {
  const serverDir = getInstanceServerDir(instanceId);
  await ensureDir(serverDir);

  const installerVersion = await catalogService.getLatestFabricInstallerVersion();
  const installerName = `fabric-installer-${installerVersion}.jar`;
  const installerPath = path.join(getInstallerCacheDir(), installerName);
  const installerUrl = `${FABRIC_MAVEN_BASE}/${installerVersion}/fabric-installer-${installerVersion}.jar`;

  await logPrepare(instanceId, `Using Fabric installer ${installerVersion}`);
  await downloadIfMissing(installerUrl, installerPath, { 'User-Agent': USER_AGENT });

  await ensureOverwriteAllowed([
    path.join(serverDir, 'fabric-server-launch.jar'),
    path.join(serverDir, 'fabric-server-launcher.jar'),
  ], overwrite);

  await runCommand(instanceId, javaBin, [
    '-jar',
    installerPath,
    'server',
    '-dir',
    serverDir,
    '-mcversion',
    minecraftVersion,
    '-loader',
    loaderVersion,
    '-downloadMinecraft',
  ], serverDir);

  const entries = await fs.readdir(serverDir);
  const jarCandidate = entries.find((name) => name.startsWith('fabric-server-launch'));
  if (!jarCandidate) {
    throw { status: 500, message: 'Fabric server launch JAR not found after installation' } as PrepareError;
  }

  await instanceManager.updateInstance(instanceId, {
    serverType: 'fabric',
    minecraftVersion,
    loader: { type: 'fabric', version: loaderVersion },
    serverJar: jarCandidate,
    startup: { mode: 'jar' },
  });
};

const prepareForgeLike = async (
  instanceId: string,
  serverType: 'forge' | 'neoforge',
  minecraftVersion: string | undefined,
  loaderVersion: string,
  overwrite: boolean,
  javaBin: string,
) => {
  const serverDir = getInstanceServerDir(instanceId);
  await ensureDir(serverDir);

  const installerName =
    serverType === 'forge'
      ? `forge-${minecraftVersion}-${loaderVersion}-installer.jar`
      : `neoforge-${loaderVersion}-installer.jar`;
  const installerPath = path.join(getInstallerCacheDir(), installerName);

  const installerUrl =
    serverType === 'forge'
      ? `${FORGE_MAVEN_BASE}/${minecraftVersion}-${loaderVersion}/forge-${minecraftVersion}-${loaderVersion}-installer.jar`
      : `${NEOFORGE_MAVEN_BASE}/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;

  await logPrepare(instanceId, `Using ${serverType} installer ${loaderVersion}`);
  await downloadIfMissing(installerUrl, installerPath, { 'User-Agent': USER_AGENT });

  await runCommand(instanceId, javaBin, ['-jar', installerPath, '--installServer'], serverDir);

  const runScript = process.platform === 'win32' ? 'run.bat' : 'run.sh';
  const fallbackScript = process.platform === 'win32' ? 'run.sh' : 'run.bat';
  const scriptCandidates = [runScript, fallbackScript];

  let script: string | undefined;
  for (const candidate of scriptCandidates) {
    const candidatePath = path.join(serverDir, candidate);
    try {
      await fs.access(candidatePath);
      script = candidate;
      break;
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  if (!script) {
    throw { status: 500, message: 'Startup script not found after installer finished' } as PrepareError;
  }

  await instanceManager.updateInstance(instanceId, {
    serverType,
    minecraftVersion,
    loader: { type: serverType, version: loaderVersion },
    startup: { mode: 'script', script, args: ['nogui'] },
  });
};

router.post('/:id/prepare', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    serverType,
    minecraftVersion,
    overwrite = false,
    loaderVersion,
    forgeVersion,
    neoforgeVersion,
    hytaleInstallMode,
    hytaleDownloaderUrl,
    hytaleImportServerPath,
    hytaleImportAssetsPath,
  } = req.body as {
    serverType?: ServerType;
    minecraftVersion?: string;
    overwrite?: boolean;
    loaderVersion?: string;
    forgeVersion?: string;
    neoforgeVersion?: string;
    hytaleInstallMode?: HytaleInstallMode;
    hytaleDownloaderUrl?: string;
    hytaleImportServerPath?: string;
    hytaleImportAssetsPath?: string;
  };

  const normalizeOptionalString = (value?: string) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  if (!serverType || !allowedTypes.includes(serverType)) {
    return res.status(400).json({ error: 'serverType must be one of vanilla, paper, fabric, forge, neoforge, hytale' });
  }

  const instance = await instanceManager.getInstance(id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  let javaBin: string | null = null;
  try {
    const resolved = await resolveJavaForInstance(
      instance,
      minecraftVersion ?? instance.minecraftVersion ?? '',
      serverType,
    );
    const javaRequirement =
      serverType === 'hytale'
        ? getJavaRequirement(minecraftVersion ?? instance.minecraftVersion ?? '', serverType)
        : resolved.status === 'needs_java'
          ? resolved.requirement
          : undefined;
    if (resolved.status === 'needs_java') {
      return res.status(409).json({
        error: 'NEEDS_JAVA',
        recommendedMajor: resolved.requirement.major,
        requirement: resolved.requirement,
        candidates: resolved.candidates,
        reasons: resolved.reasons,
      });
    }
    javaBin = resolved.javaBin;
    if (serverType === 'hytale') {
      if (!javaRequirement) {
        await logPrepare(id, 'Java requirement missing for Hytale instance prepare');
        return res.status(500).json({
          error: 'JAVA_REQUIREMENT_MISSING',
          detail: 'Java requirement could not be determined for Hytale instance prepare',
        });
      }
      try {
        await verifyJavaMajor(javaBin || 'java', javaRequirement.major);
      } catch (error: any) {
        await logPrepare(id, `Java ${javaRequirement.major} required. ${error?.message ?? 'Check failed.'}`);
        return res.status(409).json({
          error: 'NEEDS_JAVA',
          recommendedMajor: javaRequirement.major,
          requirement: javaRequirement,
          candidates: resolved.candidates,
          detail: error?.message ?? `Java ${javaRequirement.major} required`,
        });
      }
    }
  } catch (error: any) {
    if (error instanceof InstanceActionError) {
      return res.status(error.status).json(error.body);
    }
    console.error('Java resolution failed for prepare', error);
    return res.status(500).json({ error: 'Failed to resolve Java runtime' });
  }

  try {
    if ((serverType === 'vanilla' || serverType === 'paper' || serverType === 'forge' || serverType === 'fabric') && (!minecraftVersion || !minecraftVersion.trim())) {
      throw { status: 400, message: 'minecraftVersion is required for this serverType' } as PrepareError;
    }

    await logPrepare(id, `Preparing instance ${id} (${serverType})`);

    if (serverType === 'vanilla' || serverType === 'paper') {
      await prepareVanillaOrPaper(id, serverType, minecraftVersion!, overwrite);
    } else if (serverType === 'fabric') {
      const resolvedLoader = await resolveLoaderVersion(minecraftVersion!, 'fabric', loaderVersion);
      await prepareFabric(id, minecraftVersion!, resolvedLoader, overwrite, javaBin || 'java');
    } else if (serverType === 'forge') {
      const resolvedForge = await resolveLoaderVersion(minecraftVersion!, 'forge', forgeVersion);
      await prepareForgeLike(id, 'forge', minecraftVersion!, resolvedForge, overwrite, javaBin || 'java');
    } else if (serverType === 'neoforge') {
      const resolvedNeoForge = await resolveLoaderVersion(minecraftVersion ?? '', 'neoforge', neoforgeVersion);
      await prepareForgeLike(
        id,
        'neoforge',
        minecraftVersion,
        resolvedNeoForge,
        overwrite,
        javaBin || 'java',
      );
    } else if (serverType === 'hytale') {
      const mode = hytaleInstallMode ?? instance.hytale?.install?.mode ?? 'downloader';
      let installResult;
      if (mode === 'downloader') {
        await logPrepare(id, 'Installing Hytale server via Downloader CLI');
        const globalDownloaderUrl = await getGlobalHytaleDownloaderUrl();
        const instanceDownloaderUrl = normalizeOptionalString(
          hytaleDownloaderUrl ?? instance.hytale?.install?.downloaderUrl,
        );
        installResult = await installFromDownloader(
          id,
          {
            mode,
            downloaderUrl: instanceDownloaderUrl,
            downloaderUrlCandidates: {
              global: globalDownloaderUrl,
              env: process.env.HYTALE_DOWNLOADER_URL,
            },
            patchline: instance.hytale?.install?.patchline,
            skipUpdateCheck: instance.hytale?.install?.skipUpdateCheck,
            overwrite,
          },
          (message) => logPrepare(id, message),
        );
      } else if (mode === 'import') {
        await logPrepare(id, 'Importing existing Hytale server files');
        installResult = await installFromImport(id, {
          mode,
          importServerPath: hytaleImportServerPath ?? instance.hytale?.install?.importServerPath,
          importAssetsPath: hytaleImportAssetsPath ?? instance.hytale?.install?.importAssetsPath,
          overwrite,
        });
      } else {
        throw { status: 400, message: 'Invalid hytale install mode' } as PrepareError;
      }

      await instanceManager.updateInstance(id, {
        serverType: 'hytale',
        minecraftVersion: undefined,
        serverJar: installResult?.serverJar,
        startup: { mode: 'jar' },
        hytale: {
          ...(instance.hytale ?? {}),
          assetsPath: installResult?.assetsPath ?? instance.hytale?.assetsPath,
          install: {
            mode,
            downloaderUrl: normalizeOptionalString(
              hytaleDownloaderUrl ?? instance.hytale?.install?.downloaderUrl,
            ),
            patchline: instance.hytale?.install?.patchline,
            skipUpdateCheck: instance.hytale?.install?.skipUpdateCheck,
            importServerPath: hytaleImportServerPath ?? instance.hytale?.install?.importServerPath,
            importAssetsPath: hytaleImportAssetsPath ?? instance.hytale?.install?.importAssetsPath,
          },
        },
      });
    }

    const updated = await instanceManager.getInstance(id);
    return res.json({
      id,
      serverType,
      minecraftVersion: minecraftVersion ?? updated?.minecraftVersion,
      loaderVersion: updated?.loader?.version ?? loaderVersion ?? forgeVersion ?? neoforgeVersion,
      status: 'prepared',
    });
  } catch (error: any) {
    const status = error?.status ?? 500;
    if (error?.code === 'HYTALE_DOWNLOADER_URL_MISSING') {
      const detail = error?.diagnostics ? `Checked sources: ${error.diagnostics}` : undefined;
      console.error(`Prepare failed for instance ${id}`, error);
      await logPrepare(id, 'Preparation failed: Hytale downloader URL is missing or invalid.');
      return res.status(422).json({
        error: 'HYTALE_DOWNLOADER_URL_MISSING',
        message: 'Hytale Downloader URL is missing or invalid. Please set it in Settings.',
        detail,
      });
    }
    const message = error?.message || 'Failed to prepare instance';
    console.error(`Prepare failed for instance ${id}`, error);
    await logPrepare(id, `Preparation failed: ${message}`);
    return res.status(status).json({ error: message, detail: error?.detail });
  }
});

export default router;
