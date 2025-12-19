import { Request, Response, Router } from 'express';
import { InstanceManager } from '../core/InstanceManager';
import { InstanceConfig, ServerType } from '../core/types';
import { resolveServerPort } from '../services/serverProperties.service';

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
        const serverPort = await resolveServerPort(instance.id).catch(() => undefined);
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
    const serverPort = await resolveServerPort(instance.id).catch(() => undefined);
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
  const { name, serverType, minecraftVersion } = req.body as {
    name?: string;
    serverType?: ServerType;
    minecraftVersion?: string;
  };

  if (!name || !serverType) {
    return res.status(400).json({ error: 'name and serverType are required' });
  }

  try {
    const created = await instanceManager.createInstance({
      name,
      serverType,
      minecraftVersion,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating instance', error);
    res.status(500).json({ error: 'Failed to create instance' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await instanceManager.deleteInstance(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting instance ${req.params.id}`, error);
    res.status(500).json({ error: 'Failed to delete instance' });
  }
});

export default router;
