const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');

const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:5173';
const DEFAULT_BACKEND_PORT = Number(process.env.PORT || process.env.BACKEND_PORT || 3001);
const BACKEND_WAIT_TIMEOUT = 20000;
const BACKEND_POLL_INTERVAL = 500;
const BACKEND_HEALTH_PATH = '/api/health';
const CONFIG_FILE_NAME = 'app-config.json';
const DEFAULT_REMOTE_CONFIG = { useRemoteBackend: false, remoteApiBase: '' };

let mainWindow;
let backendProcess = null;
let backendStatus = { status: 'stopped', port: DEFAULT_BACKEND_PORT, retries: 0 };
let quitting = false;
let stoppingBackend = false;
let runtimeConfig = {
  apiBase: '',
  platform: 'desktop',
  appDataDir: '',
  appLogDir: '',
  port: DEFAULT_BACKEND_PORT,
};

const appDataDir = process.env.APP_DATA_DIR || app.getPath('userData');
const appLogDir = process.env.APP_LOG_DIR || path.join(appDataDir, 'logs');
const backendLogPath = path.join(appLogDir, 'backend.log');
const electronLogPath = path.join(appLogDir, 'electron.log');
const rendererLogPath = path.join(appLogDir, 'renderer.log');
const appConfigPath = path.join(appDataDir, CONFIG_FILE_NAME);

fs.mkdirSync(appDataDir, { recursive: true });
fs.mkdirSync(appLogDir, { recursive: true });

const createRotatingLogStream = (filePath, maxSizeBytes = 5 * 1024 * 1024, keep = 3) => {
  const rotate = () => {
    try {
      if (!fs.existsSync(filePath)) return;
      const { size } = fs.statSync(filePath);
      if (size < maxSizeBytes) return;
      for (let i = keep - 1; i >= 0; i -= 1) {
        const source = i === 0 ? filePath : `${filePath}.${i}`;
        const target = `${filePath}.${i + 1}`;
        if (fs.existsSync(source)) {
          fs.renameSync(source, target);
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('log rotation error', error);
    }
  };

  rotate();
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  stream.on('close', rotate);
  return stream;
};

const electronLog = createRotatingLogStream(electronLogPath);
const rendererLog = createRotatingLogStream(rendererLogPath);
const backendLog = createRotatingLogStream(backendLogPath);

const logElectron = (message, meta = {}) => {
  const line = `[${new Date().toISOString()}] ${message}${
    Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
  }${os.EOL}`;
  electronLog.write(line);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const broadcastBackendStatus = () => {
  const payload = { ...backendStatus, logPath: backendLogPath };
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('backend-status', payload);
  }
};

const readUserConfig = () => {
  try {
    if (!fs.existsSync(appConfigPath)) return { ...DEFAULT_REMOTE_CONFIG };
    const file = fs.readFileSync(appConfigPath, 'utf-8');
    const parsed = JSON.parse(file);
    return { ...DEFAULT_REMOTE_CONFIG, ...parsed };
  } catch (error) {
    logElectron('Failed to read user config', { message: error.message });
    return { ...DEFAULT_REMOTE_CONFIG };
  }
};

const writeUserConfig = (config) => {
  try {
    fs.mkdirSync(path.dirname(appConfigPath), { recursive: true });
    fs.writeFileSync(appConfigPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    logElectron('Failed to write user config', { message: error.message });
  }
};

const getBackendScriptPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'dist', 'index.js');
  }

  return path.join(app.getAppPath(), 'backend', 'dist', 'index.js');
};

const getNodeBinary = () => {
  const packagedNode = path.join(process.resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  if (app.isPackaged && fs.existsSync(packagedNode)) {
    return packagedNode;
  }

  return process.env.NODE_BINARY || 'node';
};

const checkPortAvailable = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      server.close();
      if (error?.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });

const fetchBackendHealth = async (baseUrl, timeoutMs = 3000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const healthUrl = `${baseUrl}${BACKEND_HEALTH_PATH}`;
    const response = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { reachable: true, ok: false, isOurs: false };

    const data = await response.json().catch(() => ({}));
    const ok = data?.ok === true || data?.status === 'ok';
    const version = data?.version;
    const messageText = typeof data?.message === 'string' ? data.message.toLowerCase() : '';
    const isOurs = ok && (Boolean(version) || messageText.includes('minecraft'));
    return { reachable: true, ok, version, data, isOurs };
  } catch (error) {
    clearTimeout(timeout);
  }

  return { reachable: false, ok: false, isOurs: false };
};

const waitForBackend = async (baseUrl, timeoutMs = BACKEND_WAIT_TIMEOUT) => {
  const started = Date.now();
  let lastHealth = null;

  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const health = await fetchBackendHealth(baseUrl);
    if (health.reachable && health.ok) {
      return health;
    }
    lastHealth = health;
    // eslint-disable-next-line no-await-in-loop
    await wait(BACKEND_POLL_INTERVAL);
  }

  return lastHealth ?? { reachable: false, ok: false };
};

const showBackendErrorDialog = (message) => {
  dialog.showErrorBox('Backend nicht erreichbar', message);
};

const findAvailablePort = async (preferredPort) => {
  if (await checkPortAvailable(preferredPort)) return preferredPort;

  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(preferredPort));
  });
};

const startBackendProcess = async (port) => {
  const backendPath = getBackendScriptPath();
  if (!fs.existsSync(backendPath)) {
    backendStatus = {
      status: 'failed',
      reason: 'missing-backend',
      port,
      retries: backendStatus.retries,
    };
    logElectron('Backend entrypoint missing', { backendPath });
    broadcastBackendStatus();
    showBackendErrorDialog(
      'Der Backend-Einstiegspunkt wurde nicht gefunden. Bitte stellen Sie sicher, dass der Build ausgeführt wurde.'
    );
    return false;
  }

  backendStatus = { status: 'starting', port, retries: backendStatus.retries };
  broadcastBackendStatus();

  const backendEnv = {
    ...process.env,
    PORT: String(port),
    APP_DATA_DIR: appDataDir,
    APP_LOG_DIR: appLogDir,
    LOG_PATH: backendLogPath,
  };

  if (app.isPackaged) {
    backendEnv.STATIC_DIR = path.join(process.resourcesPath, 'frontend', 'dist');
  }

  const nodeBinary = getNodeBinary();

  backendProcess = spawn(nodeBinary, [backendPath], {
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    cwd: path.dirname(backendPath),
  });

  backendProcess.stdout?.pipe(backendLog, { end: false });
  backendProcess.stderr?.pipe(backendLog, { end: false });

  backendProcess.unref();
  logElectron('Backend process started', { pid: backendProcess.pid, port });
  backendStatus = { status: 'running', port, retries: backendStatus.retries, pid: backendProcess.pid };
  broadcastBackendStatus();
  return true;
};

const stopBackend = async () => {
  if (!backendProcess) return Promise.resolve();
  stoppingBackend = true;
  return new Promise((resolve) => {
    try {
      process.kill(backendProcess.pid);
    } catch (error) {
      logElectron('Error stopping backend', { message: error.message });
    }

    const timeout = setTimeout(() => {
      stoppingBackend = false;
      resolve();
    }, 2000);

    backendProcess.once('exit', () => {
      clearTimeout(timeout);
      stoppingBackend = false;
      resolve();
    });
  });
};

const startLocalBackendAndWait = async (preferredPort) => {
  const port = await findAvailablePort(preferredPort);
  const started = await startBackendProcess(port);
  if (!started) {
    return { ok: false, port };
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForBackend(baseUrl);
  if (!health?.reachable || !health.ok || !health.isOurs) {
    backendStatus = { status: 'failed', reason: 'unhealthy', port, retries: 0 };
    broadcastBackendStatus();
    showBackendErrorDialog('Das eingebettete Backend konnte nicht gestartet werden. Bitte prüfen Sie die Logs.');
    return { ok: false, port };
  }

  backendStatus = { status: 'running', port, retries: 0 };
  broadcastBackendStatus();
  return { ok: true, port, baseUrl };
};

const waitForRemoteBackend = async (remoteApiBase) => {
  const normalized = remoteApiBase.replace(/\/$/, '');
  const health = await waitForBackend(normalized);
  if (!health?.reachable || !health.ok) {
    backendStatus = { status: 'failed', reason: 'remote-unreachable', port: null, retries: 0 };
    broadcastBackendStatus();
    showBackendErrorDialog('Das Remote-Backend ist nicht erreichbar. Bitte prüfen Sie die URL oder Ihre Verbindung.');
    return { ok: false, port: null };
  }

  backendStatus = { status: 'running', port: null, retries: 0 };
  broadcastBackendStatus();
  return { ok: true, baseUrl: normalized, port: null };
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: !app.isPackaged,
    },
  });

  const loadUrl = !app.isPackaged
    ? DEV_URL
    : `file://${path.join(process.resourcesPath, 'frontend', 'dist', 'index.html')}`;

  mainWindow.loadURL(loadUrl);

  if (app.isPackaged) {
    mainWindow.removeMenu();
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }
};

const initIpc = () => {
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: `${process.platform}/${process.arch}`,
  }));

  ipcMain.handle('get-app-paths', () => ({
    dataDir: appDataDir,
    logDir: appLogDir,
    backendLog: backendLogPath,
  }));

  ipcMain.handle('get-runtime-config', () => runtimeConfig);
  ipcMain.on('get-runtime-config-sync', (event) => {
    event.returnValue = runtimeConfig;
  });

  ipcMain.handle('get-remote-config', () => readUserConfig());
  ipcMain.handle('set-remote-config', (_event, payload) => {
    const newConfig = { ...DEFAULT_REMOTE_CONFIG, ...payload };
    writeUserConfig(newConfig);
    return newConfig;
  });

  ipcMain.handle('open-logs-folder', () => shell.openPath(appLogDir));
  ipcMain.handle('restart-backend', async () => {
    backendStatus = { status: 'restarting', port: runtimeConfig.port, retries: 0 };
    broadcastBackendStatus();
    await stopBackend();
    const started = await startLocalBackendAndWait(runtimeConfig.port ?? DEFAULT_BACKEND_PORT);
    if (!started.ok) {
      return backendStatus;
    }
    runtimeConfig = {
      ...runtimeConfig,
      apiBase: started.baseUrl,
      port: started.port,
    };
    return backendStatus;
  });

  ipcMain.handle('get-backend-status', () => ({ ...backendStatus, logPath: backendLogPath }));

  ipcMain.handle('copy-diagnostics', async (_event, payload) => {
    const { clipboard } = require('electron');
    clipboard.writeText(payload || '');
    return true;
  });

  ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.on('renderer-error', (_event, data) => {
    const line = `[${new Date().toISOString()}] ${data?.message || 'renderer-error'} ${
      data?.stack ? `\n${data.stack}` : ''
    }${os.EOL}`;
    rendererLog.write(line);
  });
};

const installGlobalHandlers = () => {
  process.on('uncaughtException', (error) => {
    logElectron('Uncaught exception', { message: error.message, stack: error.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logElectron('Unhandled rejection', { reason: String(reason) });
  });
};

const bootstrap = async () => {
  installGlobalHandlers();

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('ready', async () => {
    initIpc();

    const userConfig = readUserConfig();
    const useRemote = Boolean(userConfig.useRemoteBackend && userConfig.remoteApiBase);

    let backendReady = { ok: false, baseUrl: '', port: DEFAULT_BACKEND_PORT };

    if (useRemote) {
      backendReady = await waitForRemoteBackend(userConfig.remoteApiBase);
    } else {
      backendReady = await startLocalBackendAndWait(DEFAULT_BACKEND_PORT);
    }

    if (!backendReady.ok) {
      app.quit();
      return;
    }

    runtimeConfig = {
      ...runtimeConfig,
      apiBase: backendReady.baseUrl || (useRemote ? userConfig.remoteApiBase : ''),
      platform: 'desktop',
      appDataDir,
      appLogDir,
      port: typeof backendReady.port === 'number' ? backendReady.port : null,
    };

    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    stopBackend().finally(() => {
      app.exit(0);
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
};

bootstrap();
