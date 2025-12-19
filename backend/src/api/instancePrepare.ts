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
import { resolveJavaForInstance } from '../services/java.service';
import { InstanceActionError } from '../core/InstanceActionError';

const router = Router();
const instanceManager = new InstanceManager();
const downloadService = new DownloadService();
const catalogService = new CatalogService();
const logService = new LogService();

const FORGE_MAVEN_BASE = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_MAVEN_BASE = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const FABRIC_MAVEN_BASE = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer';
const USER_AGENT = 'MinecraftPanel/0.1 (+https://example.local)';

const allowedTypes: ServerType[] = ['vanilla', 'paper', 'fabric', 'forge', 'neoforge'];

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
  } = req.body as {
    serverType?: ServerType;
    minecraftVersion?: string;
    overwrite?: boolean;
    loaderVersion?: string;
    forgeVersion?: string;
    neoforgeVersion?: string;
  };

  if (!serverType || !allowedTypes.includes(serverType)) {
    return res.status(400).json({ error: 'serverType must be one of vanilla, paper, fabric, forge, neoforge' });
  }

  const instance = await instanceManager.getInstance(id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  let javaBin: string | null = null;
  try {
    const resolved = await resolveJavaForInstance(instance, minecraftVersion ?? instance.minecraftVersion ?? '', serverType);
    if (resolved.status === 'needs_java') {
      return res.status(409).json({
        error: 'NEEDS_JAVA',
        recommendedMajor: resolved.recommendedMajor,
        candidates: resolved.candidates,
      });
    }
    javaBin = resolved.javaBin;
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
    const message = error?.message || 'Failed to prepare instance';
    console.error(`Prepare failed for instance ${id}`, error);
    await logPrepare(id, `Preparation failed: ${message}`);
    return res.status(status).json({ error: message, detail: error?.detail });
  }
});

export default router;
