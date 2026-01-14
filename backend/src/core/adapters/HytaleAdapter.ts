import path from 'node:path';
import { getInstanceServerDir } from '../../config/paths';
import { InstanceConfig } from '../types';
import { StartSpec } from '../StartSpec';

export const HYTALE_DEFAULT_PORT = 5520;
export const HYTALE_DEFAULT_BIND = '0.0.0.0';
export const HYTALE_DEFAULT_ASSETS = 'Assets.zip';

export const HYTALE_DATA_DIRS = [
  'universe',
  'logs',
  'mods',
  '.cache',
  'config.json',
  'whitelist.json',
  'permissions.json',
];

export const HytaleAdapter = {
  type: 'hytale',
  runtime: 'java25',
  requiredPorts: [{ port: HYTALE_DEFAULT_PORT, protocol: 'udp' as const }],
  dataDirs: HYTALE_DATA_DIRS,
  buildStartSpec: (
    instance: InstanceConfig,
    instanceId: string,
    javaResolution?: { javaBin: string; javaHome?: string },
  ): StartSpec => {
    const cwd = getInstanceServerDir(instanceId);
    const javaPathCandidate = instance.java?.path ?? instance.java?.javaPath ?? instance.javaPath;
    const javaBin = javaResolution?.javaBin ?? javaPathCandidate ?? 'java';
    const javaHome = javaResolution?.javaHome;

    const hytale = instance.hytale ?? {};
    const port = hytale.port ?? HYTALE_DEFAULT_PORT;
    const bind = hytale.bind ?? HYTALE_DEFAULT_BIND;
    const assetsPath = hytale.assetsPath ?? HYTALE_DEFAULT_ASSETS;
    const authMode = hytale.authMode ?? 'authenticated';
    const jar = instance.serverJar?.trim();
    if (!jar) {
      throw new Error('Hytale server jar not configured. Run prepare to download game.zip.');
    }

    const args: string[] = [];
    const memory = instance.memory ?? {};

    if (memory.min) {
      args.push(`-Xms${memory.min}`);
    }

    if (memory.max) {
      args.push(`-Xmx${memory.max}`);
    }

    const jvmArgs = hytale.jvmArgs ?? [];
    args.push(...jvmArgs, '-jar', jar, '--assets', assetsPath, '--bind', `${bind}:${port}`);

    if (authMode === 'offline') {
      args.push('--auth', 'offline');
    }

    const env = { ...process.env } as NodeJS.ProcessEnv;

    if (javaHome) {
      env.JAVA_HOME = javaHome;
      const binPath = path.join(javaHome, 'bin');
      const delimiter = path.delimiter;
      env.PATH = env.PATH ? `${binPath}${delimiter}${env.PATH}` : binPath;
    }

    return { command: javaBin, args, cwd, env };
  },
};
