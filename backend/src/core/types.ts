export type ServerType = 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' | 'modded' | 'hytale';

export type LoaderType = 'fabric' | 'forge' | 'neoforge';

export interface LoaderInfo {
  type?: LoaderType;
  version?: string;
}

export interface JavaConfig {
  strategy?: 'managed' | 'system' | 'auto';
  major?: number;
  path?: string | null;
  javaPath?: string | null;
  preferredMajor?: number;
}

export interface StartupConfig {
  mode: 'jar' | 'script';
  script?: string;
  args?: string[];
}

export type HytaleAuthMode = 'authenticated' | 'offline';

export interface HytaleInstallConfig {
  mode?: 'downloader' | 'import';
  downloaderUrl?: string;
  importServerPath?: string;
  importAssetsPath?: string;
}

export interface HytaleConfig {
  assetsPath?: string;
  bind?: string;
  port?: number;
  authMode?: HytaleAuthMode;
  jvmArgs?: string[];
  install?: HytaleInstallConfig;
}

export interface InstanceBase {
  id: string;
  name: string;
  serverType: ServerType;
  minecraftVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceConfig extends InstanceBase {
  memory?: {
    min?: string;
    max?: string;
  };
  javaPath?: string;
  java?: JavaConfig;
  serverJar?: string;
  nogui?: boolean;
  autoAcceptEula?: boolean;
  loader?: LoaderInfo;
  startup?: StartupConfig;
  sleep?: SleepSettings;
  backups?: BackupSettings;
  rconEnabled?: boolean;
  rconHost?: string;
  rconPort?: number;
  rconPassword?: string;
  paperPluginEnabled?: boolean;
  pluginToken?: string;
  pluginPort?: number;
  serverPort?: number;
  hytale?: HytaleConfig;
}

export interface SleepSettings {
  sleepEnabled?: boolean;
  idleMinutes?: number;
  wakeOnPing?: boolean;
  wakeGraceSeconds?: number;
  stopMethod?: 'graceful';
}

export interface BackupSettings {
  maxBackups?: number;
}

export type InstanceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface InstanceRuntimeInfo {
  id: string;
  status: InstanceStatus;
  pid: number | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  startInProgress?: boolean;
  stopInProgress?: boolean;
  onlinePlayers?: number | null;
}

export type TaskType = 'backup' | 'restart' | 'stop' | 'start' | 'command' | 'sleep';

export type TaskSchedule =
  | { mode: 'cron'; expression: string }
  | { mode: 'interval'; intervalMinutes: number };

export interface ScheduledTaskPayload {
  command?: string;
}

export interface ScheduledTask {
  id: string;
  instanceId: string;
  enabled: boolean;
  type: TaskType;
  schedule: TaskSchedule;
  payload?: ScheduledTaskPayload;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  running?: boolean;
}
