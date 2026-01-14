import path from 'node:path';
import { getInstanceServerDir } from '../config/paths';
import { getAdapterForInstance } from './adapters';
import { StartSpec } from './StartSpec';
import { InstanceConfig } from './types';

export const buildStartSpec = (
  instance: InstanceConfig,
  instanceId: string,
  javaResolution?: { javaBin: string; javaHome?: string },
): StartSpec => {
  const adapter = getAdapterForInstance(instance);
  if (adapter?.type === 'hytale') {
    return adapter.buildStartSpec(instance, instanceId, javaResolution);
  }

  if (instance.serverType === 'modded') {
    return {
      command: process.execPath,
      args: ['-e', `setInterval(() => console.log('INSTANCE ${instanceId} running (modded dummy)'), 1000)`],
      cwd: getInstanceServerDir(instanceId),
      env: { ...process.env },
    };
  }

  const cwd = getInstanceServerDir(instanceId);

  if (instance.startup?.mode === 'script' && instance.startup.script) {
    const scriptPath = path.join(cwd, instance.startup.script);
    const args = instance.startup.args ?? [];

    if (process.platform === 'win32') {
      return {
        command: 'cmd',
        args: ['/c', scriptPath, ...args],
        cwd,
      };
    }

    return {
      command: 'bash',
      args: [scriptPath, ...args],
      cwd,
    };
  }

  const javaPathCandidate = instance.java?.path ?? instance.java?.javaPath ?? instance.javaPath;
  const javaBin = javaResolution?.javaBin ?? javaPathCandidate ?? 'java';
  const javaHome = javaResolution?.javaHome;
  const jar = instance.serverJar && instance.serverJar.trim() ? instance.serverJar : 'server.jar';

  const args: string[] = [];
  const memory = instance.memory ?? {};

  if (memory.min) {
    args.push(`-Xms${memory.min}`);
  }

  args.push(`-Xmx${memory.max ?? '2G'}`);
  args.push('-jar', jar);

  if (instance.nogui !== false) {
    args.push('nogui');
  }

  const env = { ...process.env } as NodeJS.ProcessEnv;

  if (javaHome) {
    env.JAVA_HOME = javaHome;
    const binPath = path.join(javaHome, 'bin');
    const delimiter = path.delimiter;
    env.PATH = env.PATH ? `${binPath}${delimiter}${env.PATH}` : binPath;
  }

  return { command: javaBin, args, cwd, env };
};
