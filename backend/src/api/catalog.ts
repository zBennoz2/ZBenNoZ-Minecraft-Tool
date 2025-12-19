import { Request, Response, Router } from 'express';
import { CatalogService } from '../core/CatalogService';

const router = Router();
const catalogService = new CatalogService();

router.get('/vanilla/versions', async (req: Request, res: Response) => {
  const typeParam = (req.query.type as string | undefined) ?? 'release';
  if (!['release', 'snapshot', 'all'].includes(typeParam)) {
    return res.status(400).json({ error: 'type must be one of release, snapshot, all' });
  }

  try {
    const result = await catalogService.getVanillaVersions(typeParam as 'release' | 'snapshot' | 'all');
    res.json(result);
  } catch (error: any) {
    console.error('Failed to fetch vanilla catalog', error);
    res.status(502).json({ error: 'Failed to fetch vanilla versions', detail: error?.message });
  }
});

router.get('/paper/versions', async (_req: Request, res: Response) => {
  try {
    const result = await catalogService.getPaperVersions();
    res.json(result);
  } catch (error: any) {
    console.error('Failed to fetch paper catalog', error);
    res.status(502).json({ error: 'Failed to fetch Paper versions', detail: error?.message });
  }
});

router.get('/paper/builds/:mcVersion', async (req: Request, res: Response) => {
  const { mcVersion } = req.params;
  try {
    const result = await catalogService.getPaperBuilds(mcVersion);
    const stableBuilds = result.builds.filter((build) => build.channel.toUpperCase() === 'STABLE');
    res.json({
      version: result.version,
      hasStable: stableBuilds.length > 0,
      builds: stableBuilds.map((build) => ({ id: build.build, channel: build.channel, time: build.time })),
    });
  } catch (error: any) {
    console.error(`Failed to fetch paper builds for ${mcVersion}`, error);
    res.status(502).json({ error: 'Failed to fetch Paper builds', detail: error?.message });
  }
});

router.get('/fabric/versions', async (_req: Request, res: Response) => {
  try {
    const result = await catalogService.getFabricVersions();
    res.json(result);
  } catch (error: any) {
    console.error('Failed to fetch fabric versions', error);
    res.status(502).json({ error: 'Failed to fetch Fabric catalog', detail: error?.message });
  }
});

router.get('/forge/versions', async (_req: Request, res: Response) => {
  try {
    const result = await catalogService.getForgeVersions();
    res.json(result);
  } catch (error: any) {
    console.error('Failed to fetch forge versions', error);
    res.status(502).json({ error: 'Failed to fetch Forge catalog', detail: error?.message });
  }
});

router.get('/neoforge/versions', async (_req: Request, res: Response) => {
  try {
    const result = await catalogService.getNeoForgeVersions();
    res.json(result);
  } catch (error: any) {
    console.error('Failed to fetch neoforge versions', error);
    res.status(502).json({ error: 'Failed to fetch NeoForge catalog', detail: error?.message });
  }
});

export default router;
