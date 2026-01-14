import { promises as fs } from 'fs';
import path from 'path';
import { LogService } from '../core/LogService';
import { getInstanceDir } from '../config/paths';

const AUTH_SUCCESS_PATTERN = /authentication successful/i;
const DEVICE_URL_PATTERN = /(https?:\/\/accounts\.hytale\.com\/device)/i;
const DEVICE_CODE_PATTERN = /\b(?:code|device code|user code)\s*[:=]\s*([a-z0-9-]{4,})/i;
const EXPIRES_IN_PATTERN = /expires in\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)/i;
const EXPIRES_AT_PATTERN = /expires at\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[tT][0-9:.+-]+(?:z|Z)?)/i;
const WAITING_PATTERN = /waiting for (authentication|authorization)|authorization pending/i;
const AUTH_ERROR_PATTERN = /(expired|malformed|invalid|unauthorized)/i;

export type HytaleAuthState =
  | 'idle'
  | 'needs_auth'
  | 'waiting_for_auth'
  | 'authenticated'
  | 'downloading'
  | 'extracting'
  | 'configured';

export interface HytaleAuthStatus {
  state: HytaleAuthState;
  authenticated: boolean;
  deviceUrl?: string;
  userCode?: string;
  matchedLine?: string;
  codeIssuedAt?: string;
  expiresAt?: string;
  message?: string;
  progress?: number;
  updatedAt?: string;
}

interface ParsedAuthInfo {
  authenticated: boolean;
  deviceUrl?: string;
  userCode?: string;
  expiresAt?: string;
  waiting?: boolean;
  authError?: boolean;
  matchedLine?: string;
}

const AUTH_STATUS_FILE = '.hytale-auth-status.json';

const calculateExpiresAt = (line: string): string | undefined => {
  const atMatch = line.match(EXPIRES_AT_PATTERN);
  if (atMatch?.[1]) {
    const parsed = new Date(atMatch[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const inMatch = line.match(EXPIRES_IN_PATTERN);
  if (!inMatch?.[1]) return undefined;
  const amount = Number.parseInt(inMatch[1], 10);
  if (!Number.isFinite(amount)) return undefined;
  const unit = inMatch[2]?.toLowerCase() ?? 's';
  const multipliers: Record<string, number> = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
  };
  const multiplier = multipliers[unit] ?? 1000;
  const expiresAt = new Date(Date.now() + amount * multiplier);
  return expiresAt.toISOString();
};

const extractAuthInfo = (line: string): ParsedAuthInfo => {
  const authenticated = AUTH_SUCCESS_PATTERN.test(line);
  const urlMatch = line.match(DEVICE_URL_PATTERN);
  const codeMatch = line.match(DEVICE_CODE_PATTERN);
  const expiresAt = calculateExpiresAt(line);
  const waiting = WAITING_PATTERN.test(line);
  const authError = AUTH_ERROR_PATTERN.test(line);

  return {
    authenticated,
    deviceUrl: urlMatch?.[1],
    userCode: codeMatch?.[1]?.toUpperCase(),
    expiresAt,
    waiting,
    authError,
    matchedLine: line,
  };
};

const getAuthStatusPath = (instanceId: string) => path.join(getInstanceDir(instanceId), AUTH_STATUS_FILE);

const readAuthStatusFile = async (instanceId: string): Promise<HytaleAuthStatus | null> => {
  try {
    const content = await fs.readFile(getAuthStatusPath(instanceId), 'utf-8');
    const parsed = JSON.parse(content) as HytaleAuthStatus;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to read Hytale auth status file', error);
    }
  }
  return null;
};

export const writeHytaleAuthStatus = async (instanceId: string, status: HytaleAuthStatus): Promise<void> => {
  const next = {
    ...status,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(getInstanceDir(instanceId), { recursive: true });
  await fs.writeFile(getAuthStatusPath(instanceId), JSON.stringify(next, null, 2), 'utf-8');
};

export const updateHytaleAuthStatus = async (
  instanceId: string,
  update: Partial<HytaleAuthStatus>,
  options?: { clearAuth?: boolean; clearMessage?: boolean },
): Promise<HytaleAuthStatus> => {
  const current = (await readAuthStatusFile(instanceId)) ?? {
    state: 'idle',
    authenticated: false,
  };
  const next: HytaleAuthStatus = {
    ...current,
    ...update,
  };
  if (options?.clearAuth) {
    delete next.deviceUrl;
    delete next.userCode;
    delete next.codeIssuedAt;
    delete next.expiresAt;
    delete next.matchedLine;
  }
  if (options?.clearMessage) {
    delete next.message;
  }
  if (!next.state) {
    next.state = 'idle';
  }
  if (typeof next.authenticated !== 'boolean') {
    next.authenticated = false;
  }
  await writeHytaleAuthStatus(instanceId, next);
  return next;
};

export const getHytaleAuthStatus = async (instanceId: string): Promise<HytaleAuthStatus> => {
  const stored = await readAuthStatusFile(instanceId);
  const logService = new LogService();
  const tail = await logService.readTail(instanceId, 400, 'prepare');
  const fallback: HytaleAuthStatus = stored ?? { state: 'idle', authenticated: false };
  if (!tail) {
    return fallback;
  }

  const lines = tail.split(/\r?\n/).filter(Boolean);
  let authenticated = fallback.authenticated;
  let deviceUrl: string | undefined = fallback.deviceUrl;
  let userCode: string | undefined = fallback.userCode;
  let matchedLine: string | undefined = fallback.matchedLine;
  let expiresAt: string | undefined = fallback.expiresAt;

  for (const line of lines) {
    const info = extractAuthInfo(line);
    if (info.authenticated) {
      authenticated = true;
      matchedLine = line;
    }
    if (info.deviceUrl) {
      deviceUrl = info.deviceUrl;
      matchedLine = line;
    }
    if (info.userCode) {
      userCode = info.userCode;
      matchedLine = line;
    }
    if (info.expiresAt) {
      expiresAt = info.expiresAt;
    }
  }

  const now = Date.now();
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false;
  const state = authenticated
    ? fallback.state === 'downloading' || fallback.state === 'extracting' || fallback.state === 'configured'
      ? fallback.state
      : 'authenticated'
    : deviceUrl || userCode
      ? expired
        ? 'needs_auth'
        : fallback.state === 'waiting_for_auth'
          ? 'waiting_for_auth'
          : 'needs_auth'
      : fallback.state ?? 'idle';

  const message =
    expired && !authenticated ? 'Authentication code expired. Retry Prepare to generate a new code.' : fallback.message;

  return {
    ...fallback,
    state,
    authenticated,
    deviceUrl,
    userCode,
    matchedLine,
    expiresAt,
    message,
  };
};

export const parseHytaleAuthLine = (line: string) => {
  if (!line) return null;
  const info = extractAuthInfo(line);
  if (info.authenticated || info.deviceUrl || info.userCode || info.waiting || info.authError) {
    return info;
  }
  return null;
};
