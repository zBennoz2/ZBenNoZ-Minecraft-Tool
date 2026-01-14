import { LogService } from '../core/LogService';

const AUTH_SUCCESS_PATTERN = /authentication successful/i;
const DEVICE_URL_PATTERN = /(https?:\/\/accounts\.hytale\.com\/device)/i;
const DEVICE_CODE_PATTERN = /\b(?:code|device code|user code)\s*[:=]\s*([a-z0-9-]{4,})/i;

export interface HytaleAuthStatus {
  authenticated: boolean;
  deviceUrl?: string;
  userCode?: string;
  matchedLine?: string;
}

const extractAuthInfo = (line: string): HytaleAuthStatus => {
  const authenticated = AUTH_SUCCESS_PATTERN.test(line);
  const urlMatch = line.match(DEVICE_URL_PATTERN);
  const codeMatch = line.match(DEVICE_CODE_PATTERN);

  return {
    authenticated,
    deviceUrl: urlMatch?.[1],
    userCode: codeMatch?.[1]?.toUpperCase(),
    matchedLine: line,
  };
};

export const getHytaleAuthStatus = async (instanceId: string): Promise<HytaleAuthStatus> => {
  const logService = new LogService();
  const tail = await logService.readTail(instanceId, 400);
  if (!tail) {
    return { authenticated: false };
  }

  const lines = tail.split(/\r?\n/).filter(Boolean);
  let authenticated = false;
  let deviceUrl: string | undefined;
  let userCode: string | undefined;
  let matchedLine: string | undefined;

  for (const line of lines) {
    if (AUTH_SUCCESS_PATTERN.test(line)) {
      authenticated = true;
      matchedLine = line;
    }
    const urlMatch = line.match(DEVICE_URL_PATTERN);
    if (urlMatch?.[1]) {
      deviceUrl = urlMatch[1];
      matchedLine = line;
    }
    const codeMatch = line.match(DEVICE_CODE_PATTERN);
    if (codeMatch?.[1]) {
      userCode = codeMatch[1].toUpperCase();
      matchedLine = line;
    }
  }

  if (!authenticated && (deviceUrl || userCode)) {
    return {
      authenticated: false,
      deviceUrl,
      userCode,
      matchedLine,
    };
  }

  if (authenticated) {
    return { authenticated: true, deviceUrl, userCode, matchedLine };
  }

  return { authenticated: false };
};

export const parseHytaleAuthLine = (line: string) => {
  if (!line) return null;
  const info = extractAuthInfo(line);
  if (info.authenticated || info.deviceUrl || info.userCode) {
    return info;
  }
  return null;
};
