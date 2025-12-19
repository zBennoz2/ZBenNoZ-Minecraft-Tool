import { promises as fs } from 'fs';
import {
  getDataDir,
  getInstanceConfigPath,
  getInstanceDir,
  getInstanceLogsDir,
  getInstanceServerDir,
  getInstancesDir,
} from '../config/paths';
import { InstanceConfig, ServerType } from './types';

const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const slugify = (value: string) => {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Date.now().toString(36);
  return base ? `${base}-${suffix}` : suffix;
};

export class InstanceManager {
  private instancesDir: string;

  constructor() {
    this.instancesDir = getInstancesDir();
  }

  private async ensureBaseDirs() {
    await ensureDir(getDataDir());
    await ensureDir(this.instancesDir);
  }

  async listInstances(): Promise<InstanceConfig[]> {
    await this.ensureBaseDirs();
    const folders = await fs.readdir(this.instancesDir, { withFileTypes: true });

    const instances: InstanceConfig[] = [];
    for (const dirent of folders) {
      if (!dirent.isDirectory()) continue;
      const id = dirent.name;
      const instance = await this.getInstance(id);
      if (instance) instances.push(instance);
    }

    return instances;
  }

  async getInstance(id: string): Promise<InstanceConfig | null> {
    await this.ensureBaseDirs();
    const configPath = getInstanceConfigPath(id);
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(data) as InstanceConfig;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async createInstance(input: {
    name: string;
    serverType: ServerType;
    minecraftVersion?: string;
  }): Promise<InstanceConfig> {
    await this.ensureBaseDirs();

    if (!['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'modded'].includes(input.serverType)) {
      throw new Error('Invalid server type');
    }

    const id = slugify(input.name);
    const dir = getInstanceDir(id);
    await ensureDir(dir);
    await ensureDir(getInstanceServerDir(id));
    await ensureDir(getInstanceLogsDir(id));

    const timestamp = new Date().toISOString();
    const config: InstanceConfig = {
      id,
      name: input.name,
      serverType: input.serverType,
      minecraftVersion: input.minecraftVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
      serverJar: 'server.jar',
      nogui: true,
      autoAcceptEula: true,
      memory: { max: '2G' },
      java: { strategy: 'auto' },
      startup: { mode: 'jar' },
      sleep: {
        sleepEnabled: false,
        idleMinutes: 15,
        wakeOnPing: true,
        wakeGraceSeconds: 60,
        stopMethod: 'graceful',
      },
      backups: {
        maxBackups: 10,
      },
      rconEnabled: false,
      rconHost: '127.0.0.1',
      rconPort: 25575,
      rconPassword: '',
      paperPluginEnabled: false,
    };

    const configPath = getInstanceConfigPath(id);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    return config;
  }

  async deleteInstance(id: string): Promise<boolean> {
    await this.ensureBaseDirs();
    const dir = getInstanceDir(id);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async updateInstance(id: string, partial: Partial<InstanceConfig>): Promise<InstanceConfig> {
    await this.ensureBaseDirs();
    const existing = await this.getInstance(id);
    if (!existing) {
      throw new Error('Instance not found');
    }

    if (partial.serverType && !['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'modded'].includes(partial.serverType)) {
      throw new Error('Invalid server type');
    }

    const updated: InstanceConfig = {
      ...existing,
      ...partial,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const configPath = getInstanceConfigPath(id);
    await fs.writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');

    return updated;
  }
}
