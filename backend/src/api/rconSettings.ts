import { Request, Response, Router } from 'express'
import { InstanceManager } from '../core/InstanceManager'
import { PlayerActionError } from '../core/PlayerActionError'
import { InstanceConfig } from '../core/types'
import { rconService } from '../services/rcon.service'

const router = Router()
const instanceManager = new InstanceManager()

const sanitizeSettings = (instance: InstanceConfig) => ({
  rconEnabled: Boolean(instance.rconEnabled),
  rconHost: instance.rconHost || '127.0.0.1',
  rconPort: instance.rconPort ?? 25575,
  passwordSet: Boolean(instance.rconPassword && instance.rconPassword.trim().length > 0),
})

router.get('/:id/rcon-settings', async (req: Request, res: Response) => {
  try {
    const instance = await instanceManager.getInstance(req.params.id)
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' })
    }
    return res.json(sanitizeSettings(instance))
  } catch (error) {
    console.error(`Error reading RCON settings for ${req.params.id}`, error)
    return res.status(500).json({ error: 'Failed to read RCON settings' })
  }
})

router.patch('/:id/rcon-settings', async (req: Request, res: Response) => {
  try {
    const existing = await instanceManager.getInstance(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: 'Instance not found' })
    }

    const updates: Partial<InstanceConfig> = {}

    if (typeof req.body?.rconEnabled === 'boolean') {
      updates.rconEnabled = req.body.rconEnabled
    }
    if (typeof req.body?.rconHost === 'string') {
      updates.rconHost = req.body.rconHost.trim() || existing.rconHost || '127.0.0.1'
    }
    if (Number.isInteger(req.body?.rconPort)) {
      const port = Number(req.body.rconPort)
      if (port <= 0 || port > 65535) {
        return res.status(400).json({ error: 'Invalid RCON port' })
      }
      updates.rconPort = port
    }
    if (typeof req.body?.rconPassword === 'string') {
      updates.rconPassword = req.body.rconPassword
    }

    if (updates.rconEnabled && !(updates.rconPassword ?? existing.rconPassword)?.trim()) {
      return res.status(400).json({ error: 'RCON password required when enabling RCON' })
    }

    const updated = await instanceManager.updateInstance(req.params.id, updates)

    if (updated.rconEnabled) {
      try {
        await rconService.syncProperties(req.params.id)
      } catch (error) {
        console.error(`Failed to sync server.properties for ${req.params.id}`, error)
      }
    }

    return res.json({
      ...sanitizeSettings(updated),
      note: updated.rconEnabled
        ? 'server.properties updated; restart may be required for RCON changes'
        : undefined,
    })
  } catch (error) {
    console.error(`Error updating RCON settings for ${req.params.id}`, error)
    return res.status(500).json({ error: 'Failed to update RCON settings' })
  }
})

router.post('/:id/rcon/test', async (req: Request, res: Response) => {
  try {
    const instance = await instanceManager.getInstance(req.params.id)
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' })
    }

    try {
      if (!instance.rconEnabled) {
        throw new PlayerActionError(409, { error: 'RCON disabled for this instance' })
      }

      const result = await rconService.testConnection(req.params.id)
      if (!result.ok) {
        return res.status(502).json({ error: result.error })
      }
      return res.json({ ok: true })
    } catch (error) {
      if (error instanceof PlayerActionError) {
        return res.status(error.status).json(error.body)
      }
      throw error
    }
  } catch (error) {
    console.error(`Error testing RCON for ${req.params.id}`, error)
    return res.status(500).json({ error: 'Failed to test RCON connection' })
  }
})

export default router
