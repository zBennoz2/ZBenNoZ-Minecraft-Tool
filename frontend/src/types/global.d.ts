export type BackendStatusPayload = {
  status: 'stopped' | 'starting' | 'running' | 'crashed' | 'backoff' | 'failed' | 'restarting';
  port: number | null;
  retries?: number;
  delay?: number;
  reason?: string;
  logPath?: string;
};

declare global {
  interface Window {
    appBridge?: {
      getAppInfo?: () => Promise<{ version: string; name: string; platform: string }>;
      getAppPaths?: () => Promise<{ dataDir: string; logDir: string; backendLog: string }>;
      getRemoteConfig?: () => Promise<{ useRemoteBackend: boolean; remoteApiBase?: string }>;
      setRemoteConfig?: (
        payload: Partial<{ useRemoteBackend: boolean; remoteApiBase?: string }>
      ) => Promise<{ useRemoteBackend: boolean; remoteApiBase?: string }>;
      openLogsFolder?: () => Promise<string>;
      restartBackend?: () => Promise<BackendStatusPayload>;
      restartApp?: () => void;
      getBackendStatus?: () => Promise<BackendStatusPayload>;
      onBackendStatus?: (callback: (status: BackendStatusPayload) => void) => () => void;
      copyDiagnostics?: (payload: string) => Promise<boolean>;
    };
  }
}

export {};
