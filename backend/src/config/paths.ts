import path from 'path';

const resolveDataDir = () => {
  const envPath = process.env.APP_DATA_DIR;
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath);
  }
  return path.resolve(__dirname, '..', '..', 'data');
};

const resolveLogDir = () => {
  const envPath = process.env.APP_LOG_DIR;
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath);
  }
  return path.join(resolveDataDir(), 'logs');
};

const dataDir = resolveDataDir();
const logDir = resolveLogDir();
const instancesDir = path.join(dataDir, 'instances');
const cacheDir = path.join(dataDir, 'cache');
const installerCacheDir = path.join(cacheDir, 'installers');
const downloadCacheDir = path.join(cacheDir, 'downloads');
const backupsDir = path.join(dataDir, 'backups');

export const getDataDir = () => dataDir;
export const getLogDir = () => logDir;
export const getInstancesDir = () => instancesDir;
export const getInstanceDir = (id: string) => path.join(instancesDir, id);
export const getInstanceServerDir = (id: string) => path.join(getInstanceDir(id), 'server');
export const getInstanceConfigPath = (id: string) => path.join(getInstanceDir(id), 'instance.json');
export const getInstanceLogsDir = (id: string) => path.join(getInstanceDir(id), 'logs');
export const getInstanceLatestLogPath = (id: string) => path.join(getInstanceLogsDir(id), 'latest.log');
export const getInstancePrepareLogPath = (id: string) => path.join(getInstanceLogsDir(id), 'prepare.log');
export const getInstanceEulaPath = (id: string) => path.join(getInstanceServerDir(id), 'eula.txt');
export const getInstanceJarPath = (id: string, jarFileName: string) =>
  path.join(getInstanceServerDir(id), jarFileName);
export const getInstanceTasksPath = (id: string) => path.join(getInstanceDir(id), 'tasks.json');
export const getCacheDir = () => cacheDir;
export const getInstallerCacheDir = () => installerCacheDir;
export const getDownloadCacheDir = () => downloadCacheDir;
export const getBackupsDir = () => backupsDir;
export const getInstanceBackupsDir = (id: string) => path.join(backupsDir, id);
