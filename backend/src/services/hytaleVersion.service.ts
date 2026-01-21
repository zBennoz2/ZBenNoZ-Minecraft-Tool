import { promises as fs } from 'fs';
import path from 'path';
import { InstanceManager } from '../core/InstanceManager';
import { getInstanceServerDir } from '../config/paths';

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  raw: string;
  normalized: string;
}

export interface HytaleReleaseInfo {
  version: string;
  serverUrl: string;
  sha256?: string;
}

export interface HytaleReleaseManifest {
  latest: string;
  releases: HytaleReleaseInfo[];
}

export interface HytaleVersionSnapshot {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

export interface HytaleVersionProvider {
  getManifest(): Promise<HytaleReleaseManifest>;
}

const HYTALE_RELEASE_MANIFEST_URL_ENV = 'HYTALE_RELEASE_MANIFEST_URL';
const VERSION_FILES = ['version.txt', path.join('current', 'version.txt')];

const instanceManager = new InstanceManager();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseSemver = (value: string): ParsedSemver | null => {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if ([major, minor, patch].some((part) => Number.isNaN(part))) return null;
  return {
    major,
    minor,
    patch,
    raw: value,
    normalized: `${major}.${minor}.${patch}`,
  };
};

export const compareSemver = (a: string, b: string): number => {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) {
    throw new Error(`Invalid semver comparison: ${a} vs ${b}`);
  }
  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
  return parsedA.patch - parsedB.patch;
};

export const normalizeSemver = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = parseSemver(value);
  return parsed ? parsed.normalized : null;
};

export const parseHytaleReleaseManifest = (payload: unknown): HytaleReleaseManifest => {
  if (!isRecord(payload)) {
    throw new Error('Release manifest must be a JSON object.');
  }

  const latestRaw = payload.latest;
  if (typeof latestRaw !== 'string' || !normalizeSemver(latestRaw)) {
    throw new Error('Release manifest latest version is missing or invalid.');
  }

  const releasesRaw = payload.releases ?? payload.versions;
  if (!Array.isArray(releasesRaw)) {
    throw new Error('Release manifest releases array is missing.');
  }

  const releases: HytaleReleaseInfo[] = releasesRaw.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Release manifest entry must be an object.');
    }

    const versionRaw = entry.version;
    const normalizedVersion = typeof versionRaw === 'string' ? normalizeSemver(versionRaw) : null;
    if (!normalizedVersion) {
      throw new Error('Release manifest entry version is missing or invalid.');
    }

    const server = isRecord(entry.server) ? entry.server : entry.downloads;
    const serverUrl = typeof server?.url === 'string' ? server.url.trim() : '';
    if (!serverUrl) {
      throw new Error(`Release ${normalizedVersion} is missing a server.url value.`);
    }

    const sha256 =
      typeof server?.sha256 === 'string' && server.sha256.trim().length > 0 ? server.sha256.trim() : undefined;

    return {
      version: normalizedVersion,
      serverUrl,
      sha256,
    };
  });

  return {
    latest: normalizeSemver(latestRaw) ?? latestRaw,
    releases,
  };
};

export class DefaultHytaleVersionProvider implements HytaleVersionProvider {
  constructor(private manifestUrl: string) {}

  async getManifest(): Promise<HytaleReleaseManifest> {
    const response = await fetch(this.manifestUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Hytale release manifest: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as unknown;
    return parseHytaleReleaseManifest(payload);
  }
}

export const resolveHytaleManifestUrl = (): string => {
  const manifestUrl = process.env[HYTALE_RELEASE_MANIFEST_URL_ENV];
  if (!manifestUrl || !manifestUrl.trim()) {
    throw new Error(`Missing ${HYTALE_RELEASE_MANIFEST_URL_ENV}. Configure a release manifest URL.`);
  }
  return manifestUrl.trim();
};

export const getHytaleVersionProvider = (): HytaleVersionProvider => {
  const manifestUrl = resolveHytaleManifestUrl();
  return new DefaultHytaleVersionProvider(manifestUrl);
};

export const getLatestHytaleRelease = async (): Promise<HytaleReleaseInfo> => {
  const provider = getHytaleVersionProvider();
  const manifest = await provider.getManifest();
  const latest = normalizeSemver(manifest.latest) ?? manifest.latest;
  const release = manifest.releases.find((entry) => entry.version === latest);
  if (!release) {
    throw new Error(`Latest Hytale release ${latest} not found in manifest.`);
  }
  return release;
};

export const getLatestHytaleVersion = async (): Promise<string> => {
  const release = await getLatestHytaleRelease();
  return release.version;
};

export const getInstalledHytaleVersion = async (instanceId: string): Promise<string | null> => {
  const instance = await instanceManager.getInstance(instanceId);
  if (!instance || instance.serverType !== 'hytale') return null;

  const configured = normalizeSemver(instance.hytale?.install?.installedVersion ?? null);
  if (configured) return configured;

  const serverDir = getInstanceServerDir(instanceId);
  for (const fileName of VERSION_FILES) {
    const candidate = path.join(serverDir, fileName);
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      const normalized = normalizeSemver(content);
      if (normalized) return normalized;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
};

export const getHytaleVersionSnapshot = async (instanceId: string): Promise<HytaleVersionSnapshot> => {
  const [installed, latest] = await Promise.all([
    getInstalledHytaleVersion(instanceId),
    getLatestHytaleVersion().catch(() => null),
  ]);

  let updateAvailable = false;
  if (installed && latest) {
    try {
      updateAvailable = compareSemver(installed, latest) < 0;
    } catch {
      updateAvailable = false;
    }
  }

  return {
    installed,
    latest,
    updateAvailable,
  };
};
