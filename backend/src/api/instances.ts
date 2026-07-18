import { Request, Response, Router } from 'express';
import { InstanceManager } from '../core/InstanceManager';
import { InstanceConfig, LoaderType, ServerType } from '../core/types';
import { resolveServerPortForInstance } from '../services/serverProperties.service';
import { deleteInstanceWithCleanup } from '../services/instanceDeletion.service';
import { getLicenseStatus } from '../services/licenseStatus.service';
import { requireAdmin, requireResourceAdmin } from './authz';
import { localUsersService } from '../services/localUsers.service';
import { CatalogService } from '../core/CatalogService';

const router = Router();
const instanceManager = new InstanceManager();
const catalogService = new CatalogService();

const normalizeOptionalVersionInput = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'object') {
    const asObject = value as Record<string, unknown>;
    const candidate = asObject.value ?? asObject.version ?? asObject.id;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }
  return undefined;
};

const resolveCreateLoader = async (
  serverType: ServerType,
  minecraftVersion: string | undefined,
  loader: InstanceConfig['loader'] | undefined,
  forgeVersion: unknown,
  neoforgeVersion: unknown,
): Promise<InstanceConfig['loader'] | undefined> => {
  const loaderObjectVersion = normalizeOptionalVersionInput(loader?.version);

  if (serverType === 'forge') {
    const selectedForgeVersion = normalizeOptionalVersionInput(forgeVersion) ?? loaderObjectVersion;
    if (!minecraftVersion?.trim()) {
      throw { status: 400, message: 'minecraftVersion is required for Forge instances' };
    }
    if (!selectedForgeVersion) {
      throw { status: 400, message: `Bitte wähle eine Forge-Version für Minecraft ${minecraftVersion} aus.` };
    }

    const catalog = await catalogService.getForgeVersions();
    const available = catalog.loaderVersionsByMinecraft?.[minecraftVersion] ?? [];
    if (!available.includes(selectedForgeVersion)) {
      throw {
        status: 400,
        message: `Forge-Version ${selectedForgeVersion} ist für Minecraft ${minecraftVersion} nicht verfügbar.`,
        detail: `Verfügbare Forge-Versionen: ${available.join(', ') || 'keine'}`,
      };
    }

    return { type: 'forge' as LoaderType, version: selectedForgeVersion };
  }

  if (serverType === 'neoforge') {
    const selectedNeoForgeVersion = normalizeOptionalVersionInput(neoforgeVersion) ?? loaderObjectVersion;
    return selectedNeoForgeVersion ? { type: 'neoforge' as LoaderType, version: selectedNeoForgeVersion } : loader;
  }

  return loader;
};

const RESOURCE_SETTING_KEYS = new Set(['memory', 'startup', 'java', 'javaPath', 'nogui']);
const containsResourceChange = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as Record<string, unknown>;
  if (Object.keys(body).some((key) => RESOURCE_SETTING_KEYS.has(key))) return true;
  const hytale = body.hytale;
  if (hytale && typeof hytale === 'object' && Object.prototype.hasOwnProperty.call(hytale, 'jvmArgs')) return true;
  return false;
};

const sanitizeInstance = (instance: InstanceConfig, serverPort?: number) => ({
  ...instance,
  rconPassword: instance.rconPassword ? '***' : '',
  rconPasswordSet: Boolean(instance.rconPassword),
  serverPort,
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const allInstances = await instanceManager.listInstances();
    const allowedIds = req.user?.role === 'admin' ? null : new Set(await localUsersService.userInstanceIds(req.user?.id || ''));
    const instances = allowedIds ? allInstances.filter((instance) => allowedIds.has(instance.id)) : allInstances;
    const enriched = await Promise.all(
      instances.map(async (instance) => {
        const serverPort = await resolveServerPortForInstance(instance).catch(() => undefined);
        return sanitizeInstance(instance, serverPort);
      }),
    );
    res.json(enriched);
  } catch (error) {
    console.error('Error listing instances', error);
    res.status(500).json({ error: 'Failed to list instances' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const instance = await instanceManager.getInstance(req.params.id);
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    const serverPort = await resolveServerPortForInstance(instance).catch(() => undefined);
    res.json(sanitizeInstance(instance, serverPort));
  } catch (error) {
    console.error(`Error fetching instance ${req.params.id}`, error);
    res.status(500).json({ error: 'Failed to fetch instance' });
  }
});

router.put('/:id', async (req: Request, res: Response, next) => {
  if (containsResourceChange(req.body) && req.user?.role !== 'admin') {
    return requireResourceAdmin(req, res, next);
  }

  try {
    const updated = await instanceManager.updateInstance(req.params.id, req.body ?? {});
    res.json(sanitizeInstance(updated));
  } catch (error) {
    console.error(`Error updating instance ${req.params.id}`, error);
    res.status(500).json({ error: 'Failed to update instance' });
  }
});

router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { name, serverType, minecraftVersion, loader, forgeVersion, neoforgeVersion, hytale } = req.body as {
    name?: string;
    serverType?: ServerType;
    minecraftVersion?: string;
    loader?: InstanceConfig['loader'];
    forgeVersion?: unknown;
    neoforgeVersion?: unknown;
    hytale?: InstanceConfig['hytale'];
  };

  if (!name || !serverType) {
    return res.status(400).json({ error: 'name and serverType are required' });
  }

  try {
    const licenseStatus = await getLicenseStatus({ force: true });
    if (!licenseStatus.active && licenseStatus.status !== 'grace') {
      return res.status(403).json({
        error: 'LICENSE_REQUIRED',
        message: licenseStatus.message || 'Lizenz nicht aktiv.',
        status: licenseStatus,
      });
    }

    const existingInstances = await instanceManager.listInstances();
    const maxInstances = licenseStatus.limits?.max_instances ?? 0;
    const instancesUsed = licenseStatus.usage?.instances_used ?? existingInstances.length;
    if (maxInstances <= instancesUsed) {
      return res.status(403).json({
        error: 'INSTANCE_LIMIT_REACHED',
        message: `Du hast dein Instanz-Limit erreicht (${instancesUsed} von ${maxInstances}). Bitte kontaktiere uns, um dein Paket zu erweitern.`,
        limits: licenseStatus.limits,
        usage: { instances_used: instancesUsed, devices_used: licenseStatus.usage?.devices_used ?? null },
        support: licenseStatus.support,
      });
    }

    const resolvedLoader = await resolveCreateLoader(
      serverType,
      minecraftVersion,
      loader,
      forgeVersion,
      neoforgeVersion,
    );

    const created = await instanceManager.createInstance({
      name,
      serverType,
      minecraftVersion,
      loader: resolvedLoader,
      hytale,
    });
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating instance', error);
    const status = error?.status ?? 500;
    const message = error?.message ?? 'Failed to create instance';
    res.status(status).json({ error: message, message, detail: error?.detail });
  }
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await deleteInstanceWithCleanup(req.params.id);
    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Instance not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting instance ${req.params.id}`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete instance' });
  }
});

export default router;
