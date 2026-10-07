import { sortVersionsDesc } from '../utils/versionSort';

// PaperMC's current download API: https://docs.papermc.io/misc/downloads-service/
export const PAPER_PROJECT_URL = 'https://fill.papermc.io/v3/projects/paper';
export const PAPER_USER_AGENT = 'ZBenNoZ-Minecraft-Tool/1.0 (https://github.com/zBennoz2/ZBenNoZ-Minecraft-Tool3)';

export interface PaperBuild {
  build: number;
  channel: string;
  time?: string;
  download?: { url: string; sha256: string };
}

export class PaperService {
  private async request(url: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': PAPER_USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          // Retrying rejected credentials, rate limits or an unknown version immediately is not useful.
          if (response.status < 500) {
            throw new PaperRequestError(`PaperMC antwortet mit HTTP ${response.status}.`, false);
          }
          throw new PaperRequestError(`PaperMC antwortet mit HTTP ${response.status}.`, true);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        if (error instanceof PaperRequestError && !error.retryable) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw new Error(`PaperMC ist derzeit nicht erreichbar. Bitte später erneut versuchen. (${lastError instanceof Error ? lastError.message : 'Netzwerkfehler'})`);
  }

  async getVersions(): Promise<{ versions: string[] }> {
    const data = await this.request(PAPER_PROJECT_URL) as { versions?: unknown } | null;
    // v3 groups version strings by release family, unlike v2's flat array.
    if (!data?.versions || typeof data.versions !== 'object' || Array.isArray(data.versions)) {
      throw new Error('Ungültige PaperMC-Antwort: Versionsgruppen fehlen.');
    }
    const groups = Object.values(data.versions);
    if (!groups.every((group) => Array.isArray(group) && group.every((version) => typeof version === 'string' && version.length > 0))) {
      throw new Error('Ungültige PaperMC-Antwort: Versionsliste unvollständig.');
    }
    return { versions: sortVersionsDesc([...new Set(groups.flat() as string[])]) };
  }

  async getBuilds(version: string): Promise<{ version: string; builds: PaperBuild[] }> {
    const data = await this.request(`${PAPER_PROJECT_URL}/versions/${encodeURIComponent(version)}/builds`);
    if (!Array.isArray(data)) throw new Error('Ungültige PaperMC-Antwort: Build-Liste fehlt.');
    const builds = data.map((entry): PaperBuild => {
      if (!entry || !Number.isInteger(entry.id) || typeof entry.channel !== 'string') {
        throw new Error('Ungültige PaperMC-Antwort: Build-Daten unvollständig.');
      }
      const artifact = entry.downloads?.['server:default'];
      const download = artifact && typeof artifact.url === 'string' && /^https:\/\//.test(artifact.url)
        && typeof artifact.checksums?.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(artifact.checksums.sha256)
        ? { url: artifact.url, sha256: artifact.checksums.sha256.toLowerCase() } : undefined;
      return { build: entry.id, channel: entry.channel.toUpperCase(), time: entry.time, download };
    });
    return { version, builds: builds.sort((a, b) => b.build - a.build) };
  }
}

class PaperRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
