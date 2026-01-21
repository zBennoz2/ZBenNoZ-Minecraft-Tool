import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { ReadableStream } from 'stream/web';

const VANILLA_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER_USER_AGENT = 'MinecraftPanel/0.1 (+https://example.invalid; contact: admin@example.invalid)';
const PAPER_BUILDS_URL = (mcVersion: string) =>
  `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(mcVersion)}/builds`;
const PAPER_DOWNLOAD_URL = (mcVersion: string, build: number, fileName: string) =>
  `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(mcVersion)}/builds/${build}/downloads/${encodeURIComponent(fileName)}`;
const DEFAULT_USER_AGENT = 'MinecraftPanel/0.1 (+https://example.local)';
const DEFAULT_RETRIES = 3;

interface VanillaManifestEntry {
  id: string;
  type: string;
  url: string;
  releaseTime: string;
}

interface VanillaManifest {
  versions: VanillaManifestEntry[];
}

interface VanillaVersionDetails {
  downloads: {
    server?: { url: string; sha1: string };
  };
}

type PaperBuildDownloadInfo = {
  name?: string;
  sha256?: string;
};

type PaperBuildInfo = {
  build: number;
  channel?: string;
  downloads?: Record<string, PaperBuildDownloadInfo>;
};

type PaperBuildsResponse = {
  version?: string;
  builds?: PaperBuildInfo[];
};

export class DownloadService {
  private async ensureDir(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.fetchWithRetry(url, { headers });
    return (await response.json()) as T;
  }

  private async fetchWithRetry(url: string, init?: RequestInit, attempts = DEFAULT_RETRIES): Promise<Response> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const response = await fetch(url, init);
        if (!response.ok) {
          throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error(`Failed to download ${url}: response body missing`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to download resource');
  }

  async downloadToFile(url: string, destPath: string, headers?: Record<string, string>): Promise<void> {
    const response = await this.fetchWithRetry(url, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT, ...headers },
    });

    await this.ensureDir(path.dirname(destPath));
    const fileStream = createWriteStream(destPath);

    try {
      const readable = Readable.fromWeb(response.body as unknown as ReadableStream);
      await pipeline(readable, fileStream);
    } catch (error) {
      await fs.rm(destPath, { force: true });
      throw error;
    }
  }

  async sha1File(filePath: string): Promise<string> {
    return this.computeFileHash(filePath, 'sha1');
  }

  async sha256File(filePath: string): Promise<string> {
    return this.computeFileHash(filePath, 'sha256');
  }

  private async computeFileHash(filePath: string, algorithm: string): Promise<string> {
    const hash = createHash(algorithm);

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });

    return hash.digest('hex');
  }

  async downloadVanillaServerJar(versionId: string, destPath: string): Promise<void> {
    const manifest = await this.fetchJson<VanillaManifest>(VANILLA_MANIFEST_URL);
    const entry = manifest.versions.find((v) => v.id === versionId);
    if (!entry) {
      throw new Error(`Vanilla version ${versionId} not found in manifest`);
    }

    const versionDetails = await this.fetchJson<VanillaVersionDetails>(entry.url);
    const serverDownload = versionDetails.downloads.server;
    if (!serverDownload?.url || !serverDownload.sha1) {
      throw new Error(`Server download not available for version ${versionId}`);
    }

    await this.downloadToFile(serverDownload.url, destPath);

    const checksum = await this.sha1File(destPath);
    if (checksum !== serverDownload.sha1) {
      await fs.rm(destPath, { force: true });
      throw new Error(`SHA1 mismatch for downloaded server.jar (expected ${serverDownload.sha1}, got ${checksum})`);
    }
  }

  async downloadPaperServerJar(mcVersion: string, destPath: string): Promise<void> {
    const builds = await this.fetchJson<PaperBuildsResponse>(PAPER_BUILDS_URL(mcVersion), {
      'User-Agent': PAPER_USER_AGENT,
    });

    if (!builds?.builds || !Array.isArray(builds.builds) || builds.builds.length === 0) {
      throw new Error(`No Paper builds available for version ${mcVersion}`);
    }

    const sortedBuilds = builds.builds.slice().sort((a, b) => b.build - a.build);
    const preferredBuild =
      sortedBuilds.find((build) => build.channel?.toUpperCase?.() === 'STABLE') ?? sortedBuilds[0];

    const downloadInfo =
      preferredBuild.downloads?.application ??
      Object.values(preferredBuild.downloads ?? {}).find((info) => info?.name);

    if (!downloadInfo?.name) {
      throw new Error(`Server download name missing for Paper ${mcVersion} build ${preferredBuild.build}`);
    }

    const downloadUrl = PAPER_DOWNLOAD_URL(builds.version ?? mcVersion, preferredBuild.build, downloadInfo.name);

    await this.downloadToFile(downloadUrl, destPath, { 'User-Agent': PAPER_USER_AGENT });


    if (downloadInfo.sha256) {
      const hash = await this.computeFileHash(destPath, 'sha256');
      if (hash !== downloadInfo.sha256) {
        await fs.rm(destPath, { force: true });
        throw new Error(
          `SHA256 mismatch for downloaded Paper jar (expected ${downloadInfo.sha256}, got ${hash})`,
        );
      }
    }
  }
}
