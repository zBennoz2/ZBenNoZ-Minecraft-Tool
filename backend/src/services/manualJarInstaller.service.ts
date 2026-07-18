import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { getInstanceJarPath, getInstanceServerDir } from '../config/paths';
import { InstanceManager } from '../core/InstanceManager';
import { InstanceConfig, ServerType } from '../core/types';

export type ManualJarMode = 'installer' | 'server-jar';
export type ManualJarServerType = ServerType | 'custom' | 'auto';
export type ManualLog = (message: string, data?: Record<string, unknown>) => Promise<void>;

export interface ManualJarInstallInput {
  instance: InstanceConfig;
  uploadPath: string;
  originalName: string;
  size: number;
  mode: ManualJarMode;
  serverType: ManualJarServerType;
  overwrite: boolean;
  javaBin: string;
  log: ManualLog;
}

export const sanitizeJarUploadName = (name: string): string => {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.jar') ? base : `${base}.jar`;
};

const assertInside = async (parent: string, candidate: string) => {
  const resolvedParent = await fs.realpath(parent).catch(() => path.resolve(parent));
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw { status: 400, message: 'Ungültiger Zielpfad für Upload.' };
  }
};

const exists = async (filePath: string) => fs.access(filePath).then(() => true).catch(() => false);

const runInstaller = async (javaBin: string, installerPath: string, serverDir: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(javaBin, args, { cwd: serverDir });
    child.once('error', (error) => reject({ status: 500, message: 'Installer konnte nicht gestartet werden.', detail: error.message }));
    child.once('exit', (code) => (code === 0 ? resolve() : reject({ status: 500, message: `Installer fehlgeschlagen (Exit ${code}).` })));
  });

const detectStartup = async (serverDir: string) => {
  for (const script of ['run.sh', 'run.bat']) {
    if (await exists(path.join(serverDir, script))) return { startup: { mode: 'script' as const, script, args: ['nogui'] } };
  }
  const entries = await fs.readdir(serverDir, { withFileTypes: true });
  const jar = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'))
    .map((entry) => entry.name)
    .find((name) => !name.toLowerCase().includes('installer'));
  if (jar) return { serverJar: jar, startup: { mode: 'jar' as const } };
  throw { status: 500, message: 'Nach der Installation wurde keine Startdatei gefunden.' };
};

export const installManualJar = async (input: ManualJarInstallInput): Promise<InstanceConfig> => {
  const manager = new InstanceManager();
  const serverDir = getInstanceServerDir(input.instance.id);
  await fs.mkdir(serverDir, { recursive: true });
  await assertInside(serverDir, path.join(serverDir, 'server.jar'));

  await input.log('Upload wird validiert', { fileName: sanitizeJarUploadName(input.originalName), size: input.size, mode: input.mode });
  if (!input.originalName.toLowerCase().endsWith('.jar')) {
    throw { status: 400, message: 'Es sind ausschließlich .jar-Dateien erlaubt.' };
  }

  if (input.mode === 'server-jar') {
    const target = getInstanceJarPath(input.instance.id, 'server.jar');
    if ((await exists(target)) && !input.overwrite) {
      throw { status: 409, message: 'server.jar existiert bereits. Überschreiben bestätigen.' };
    }
    await fs.copyFile(input.uploadPath, target);
    await fs.rm(input.uploadPath, { force: true });
    await input.log('Direkte Server-JAR gespeichert', { serverJar: 'server.jar' });
    return manager.updateInstance(input.instance.id, {
      serverType: input.serverType === 'auto' || input.serverType === 'custom' ? input.instance.serverType : input.serverType,
      serverJar: 'server.jar',
      startup: { mode: 'jar' },
    });
  }

  const installerName = `manual-installer-${Date.now().toString(36)}.jar`;
  const installerPath = path.join(serverDir, installerName);
  await assertInside(serverDir, installerPath);
  if ((await exists(path.join(serverDir, 'run.sh'))) && !input.overwrite) {
    throw { status: 409, message: 'Eine vorhandene Installation wurde gefunden. Überschreiben bestätigen.' };
  }
  await fs.copyFile(input.uploadPath, installerPath);
  const inferredType = input.serverType === 'auto' ? input.instance.serverType : input.serverType;
  const args = inferredType === 'fabric'
    ? ['-jar', installerPath, 'server', '-dir', serverDir, '-downloadMinecraft']
    : ['-jar', installerPath, '--installServer'];
  await input.log('Installer gestartet', { serverType: inferredType, java: path.basename(input.javaBin), argsCount: args.length });
  try {
    await runInstaller(input.javaBin, installerPath, serverDir, args);
    await input.log('Installer beendet');
    const detected = await detectStartup(serverDir);
    await fs.rm(input.uploadPath, { force: true });
    await fs.rm(installerPath, { force: true });
    await input.log('Startkonfiguration gespeichert', detected.serverJar ? { serverJar: detected.serverJar } : { script: detected.startup.script });
    return manager.updateInstance(input.instance.id, {
      serverType: inferredType === 'custom' ? input.instance.serverType : inferredType,
      ...detected,
    });
  } catch (error) {
    await fs.rm(installerPath, { force: true }).catch(() => undefined);
    throw error;
  }
};
