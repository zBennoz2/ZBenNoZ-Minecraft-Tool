interface VanillaManifestEntry {
  id: string;
  type: string;
  url: string;
  releaseTime: string;
}

interface VanillaManifest {
  latest: { release: string; snapshot: string };
  versions: VanillaManifestEntry[];
}

interface PaperProjectResponse {
  versions: string[];
}

interface PaperBuildInfo {
  build: number;
  channel: string;
  time?: string;
  // optional downloads field may be present when build details are fetched
  downloads?: Record<string, unknown>;
}

interface PaperBuildsResponse {
  version: string;
  builds: PaperBuildInfo[];
}

type CacheEntry<T> = { data: T; expiresAt: number };

const VANILLA_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
// Correct PaperMC API endpoints (was a typo: 'fill' -> 'api')
const PAPER_PROJECT_URL = 'https://api.papermc.io/v2/projects/paper';
const PAPER_BUILDS_URL = (mcVersion: string) =>
  `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(mcVersion)}/builds`;
const FABRIC_GAME_VERSIONS_URL = 'https://meta.fabricmc.net/v2/versions/game';
const FABRIC_LOADER_VERSIONS_URL = (mcVersion: string) =>
  `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`;
const FABRIC_INSTALLER_VERSIONS_URL = 'https://meta.fabricmc.net/v2/versions/installer';
const FORGE_PROMOTIONS_URL =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEOFORGE_METADATA_URL =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

const CACHE_TTL_MS = 10 * 60_000;
const PAPER_USER_AGENT = 'MinecraftPanel/0.1 (+https://example.invalid; contact: admin@example.invalid)';
const FORGE_USER_AGENT = 'MinecraftPanel/0.1 (+https://example.local)';

interface FabricGameVersion {
  version: string;
  stable: boolean;
}

interface FabricLoaderVersionEntry {
  loader: { version: string };
}

interface FabricInstallerEntry {
  version: string;
  stable: boolean;
}

interface ForgePromotionsResponse {
  promos: Record<string, string>;
}

export class CatalogService {
  private vanillaCache: CacheEntry<VanillaManifest> | null = null;
  private paperVersionsCache: CacheEntry<PaperProjectResponse> | null = null;
  private paperBuildsCache = new Map<string, CacheEntry<PaperBuildsResponse>>();
  private fabricCache: CacheEntry<any> | null = null;
  private forgeCache: CacheEntry<any> | null = null;
  private neoforgeCache: CacheEntry<any> | null = null;
  private fabricInstallerCache: CacheEntry<string> | null = null;

  private isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
    return !!entry && entry.expiresAt > Date.now();
  }

  private async fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const response = await fetch(url, init);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to fetch resource');
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>, attempts = 3): Promise<T> {
    const response = await this.fetchWithRetry(url, { headers }, attempts);
    return (await response.json()) as T;
  }

  private async fetchText(url: string, headers?: Record<string, string>, attempts = 3): Promise<string> {
    const response = await this.fetchWithRetry(url, { headers }, attempts);
    return response.text();
  }

  async getVanillaVersions(type: 'release' | 'snapshot' | 'all' = 'release') {
    let manifest: VanillaManifest;

    if (this.isFresh(this.vanillaCache)) {
      manifest = this.vanillaCache.data;
    } else {
      manifest = await this.fetchJson<VanillaManifest>(VANILLA_MANIFEST_URL);
      this.vanillaCache = { data: manifest, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    const versions = manifest.versions
      .filter((version) => type === 'all' || version.type === type)
      .slice()
      .sort((a, b) => new Date(b.releaseTime).getTime() - new Date(a.releaseTime).getTime())
      .map((version) => ({ id: version.id, type: version.type, releaseTime: version.releaseTime }));

    return {
      latest: manifest.latest,
      versions,
    };
  }

  async getPaperVersions() {
    let data: PaperProjectResponse;

    if (this.isFresh(this.paperVersionsCache)) {
      data = this.paperVersionsCache.data;
    } else {
      data = await this.fetchJson<PaperProjectResponse>(PAPER_PROJECT_URL, {
        'User-Agent': PAPER_USER_AGENT,
      });
      // Defensive: ensure the API returned an array of versions
      if (!data || !Array.isArray((data as any).versions)) {
        throw new Error('Invalid PaperMC response: expected versions array')
      }
      this.paperVersionsCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    return { versions: data.versions ?? [] };
  }

  async getPaperBuilds(mcVersion: string) {
    const cacheKey = mcVersion;
    const existing = this.paperBuildsCache.get(cacheKey);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.data;
    }

    const data = await this.fetchJson<PaperBuildsResponse>(PAPER_BUILDS_URL(mcVersion), {
      'User-Agent': PAPER_USER_AGENT,
    });

    this.paperBuildsCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  async getFabricVersions() {
    if (this.isFresh(this.fabricCache)) {
      return this.fabricCache.data;
    }

    const games = await this.fetchJson<FabricGameVersion[]>(FABRIC_GAME_VERSIONS_URL);
    const stableGames = games.filter((entry) => entry.stable).slice(0, 30);
    const loaderVersionsByGame: Record<string, string[]> = {};

    for (const game of stableGames) {
      try {
        const loaders = await this.fetchJson<FabricLoaderVersionEntry[]>(
          FABRIC_LOADER_VERSIONS_URL(game.version),
        );
        loaderVersionsByGame[game.version] = loaders.map((entry) => entry.loader.version);
      } catch (error) {
        console.warn(`Failed to fetch Fabric loader list for ${game.version}`, error);
      }
    }

    const latestGame = stableGames[0];
    const latestLoaderList = latestGame ? loaderVersionsByGame[latestGame.version] ?? [] : [];
    const data = {
      gameVersions: stableGames,
      loaderVersionsByGame,
      latest: {
        game: latestGame?.version,
        loader: latestLoaderList[0],
      },
    };

    this.fabricCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  }

  async getLatestFabricInstallerVersion(): Promise<string> {
    if (this.isFresh(this.fabricInstallerCache)) {
      return this.fabricInstallerCache.data;
    }

    const installers = await this.fetchJson<FabricInstallerEntry[]>(FABRIC_INSTALLER_VERSIONS_URL);
    const stable = installers.find((entry) => entry.stable) ?? installers[0];
    if (!stable) {
      throw new Error('No Fabric installer versions available');
    }

    this.fabricInstallerCache = { data: stable.version, expiresAt: Date.now() + CACHE_TTL_MS };
    return stable.version;
  }

  async getForgeVersions() {
    if (this.isFresh(this.forgeCache)) {
      return this.forgeCache.data;
    }

    const promotions = await this.fetchJson<ForgePromotionsResponse>(FORGE_PROMOTIONS_URL, {
      'User-Agent': FORGE_USER_AGENT,
    });

    const byMinecraft: Record<
      string,
      { latest?: string; recommended?: string; all: string[] }
    > = {};

    Object.entries(promotions.promos ?? {}).forEach(([key, version]) => {
      const [mcVersion, tag] = key.split('-');
      if (!mcVersion || !tag) return;
      const bucket = byMinecraft[mcVersion] ?? { all: [] };
      if (tag === 'latest') bucket.latest = version;
      if (tag === 'recommended') bucket.recommended = version;
      if (!bucket.all.includes(version)) bucket.all.push(version);
      byMinecraft[mcVersion] = bucket;
    });

    const data = { byMinecraft };
    this.forgeCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  }

  async getNeoForgeVersions() {
    if (this.isFresh(this.neoforgeCache)) {
      return this.neoforgeCache.data;
    }

    const xml = await this.fetchText(NEOFORGE_METADATA_URL, undefined, 3);
    const versionMatches = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g)).map(
      (match) => match[1],
    );

    if (!versionMatches.length) {
      throw new Error('No NeoForge versions found');
    }

    const versions = Array.from(new Set(versionMatches));
    const latest = versions[versions.length - 1];
    const data = { versions, latest };
    this.neoforgeCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  }
}
