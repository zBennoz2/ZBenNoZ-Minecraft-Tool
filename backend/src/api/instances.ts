import { Request, Response, Router } from 'express';
import { InstanceManager } from '../core/InstanceManager';
import { InstanceConfig, ServerType } from '../core/types';
import { resolveServerPortForInstance } from '../services/serverProperties.service';
import { deleteInstanceWithCleanup } from '../services/instanceDeletion.service';
import { getLicenseStatus } from '../services/licenseStatus.service';

const router = Router();
const instanceManager = new InstanceManager();

const sanitizeInstance = (instance: InstanceConfig, serverPort?: number) => ({
  ...instance,
  rconPassword: instance.rconPassword ? '***' : '',
  rconPasswordSet: Boolean(instance.rconPassword),
  serverPort,
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const instances = await instanceManager.listInstances();
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

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await instanceManager.updateInstance(req.params.id, req.body ?? {});
    res.json(sanitizeInstance(updated));
  } catch (error) {
    console.error(`Error updating instance ${req.params.id}`, error);
    res.status(500).json({ error: 'Failed to update instance' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const { name, serverType, minecraftVersion, loader, hytale } = req.body as {
    name?: string;
    serverType?: ServerType;
    minecraftVersion?: string;
    loader?: InstanceConfig['loader'];
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

    const created = await instanceManager.createInstance({
      name,
      serverType,
      minecraftVersion,
      loader,
      hytale,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating instance', error);
    res.status(500).json({ error: 'Failed to create instance' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
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
