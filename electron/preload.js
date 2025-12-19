const { contextBridge, ipcRenderer } = require('electron');

const runtimeConfig = ipcRenderer.sendSync('get-runtime-config-sync') || {};
const apiBaseUrl = runtimeConfig.apiBase || '';
const apiKey = runtimeConfig.apiKey || process.env.API_KEY || '';

const sharedConfig = {
  ...runtimeConfig,
  apiBase: apiBaseUrl,
  apiBaseUrl,
  apiKey,
  isElectron: true,
};

contextBridge.exposeInMainWorld('__APP_CONFIG__', sharedConfig);
contextBridge.exposeInMainWorld('appConfig', sharedConfig);

contextBridge.exposeInMainWorld('appBridge', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getAppPaths: () => ipcRenderer.invoke('get-app-paths'),
  getRemoteConfig: () => ipcRenderer.invoke('get-remote-config'),
  setRemoteConfig: (payload) => ipcRenderer.invoke('set-remote-config', payload),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('backend-status', listener);
    return () => ipcRenderer.removeListener('backend-status', listener);
  },
  copyDiagnostics: (payload) => ipcRenderer.invoke('copy-diagnostics', payload),
});

contextBridge.exposeInMainWorld('appInfo', {
  name: 'Minecraft AMP',
});

window.addEventListener('error', (event) => {
  ipcRenderer.send('renderer-error', {
    message: event.message,
    stack: event.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('renderer-error', {
    message: String(event.reason),
    stack: event.reason?.stack,
  });
});
