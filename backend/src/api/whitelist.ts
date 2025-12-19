import { promises as fs } from 'fs'
import path from 'path'
import { Request, Response, Router } from 'express'
import { InstanceManager } from '../core/InstanceManager'
import { getInstanceServerDir } from '../config/paths'
import { processManager } from '../services/processManager.service'

interface WhitelistEntry {
  uuid?: string | null
  name: string
}

const router = Router()
const instanceManager = new InstanceManager()

const WHITELIST_FILENAME = 'whitelist.json'

const getWhitelistPath = (id: string) => path.join(getInstanceServerDir(id), WHITELIST_FILENAME)

const ensureInstanceOr404 = async (id: string, res: Response) => {
  const instance = await instanceManager.getInstance(id)
  if (!instance) {
    res.status(404).json({ error: 'Instance not found' })
    return null
  }
  return instance
}

const readWhitelist = async (id: string): Promise<WhitelistEntry[]> => {
  const filePath = getWhitelistPath(id)
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => typeof entry?.name === 'string').map((entry) => ({
        uuid: typeof entry.uuid === 'string' ? entry.uuid : null,
        name: String(entry.name),
      }))
    }
    return []
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

const writeWhitelist = async (id: string, entries: WhitelistEntry[]): Promise<void> => {
  const filePath = getWhitelistPath(id)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8')
}

const sanitizeName = (name: string) => name.trim().slice(0, 32)

router.get('/:id/whitelist', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const instance = await ensureInstanceOr404(id, res)
    if (!instance) return

    const entries = await readWhitelist(id)
    res.json({ id, entries })
  } catch (error) {
    console.error(`Error reading whitelist for ${id}`, error)
    res.status(500).json({ error: 'Failed to read whitelist' })
  }
})

router.post('/:id/whitelist', async (req: Request, res: Response) => {
  const { id } = req.params
  const rawName = typeof req.body?.name === 'string' ? req.body.name : ''
  const name = sanitizeName(rawName)

  if (!name) {
    return res.status(400).json({ error: 'Player name is required' })
  }

  try {
    const instance = await ensureInstanceOr404(id, res)
    if (!instance) return

    const existing = await readWhitelist(id)
    if (existing.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Player already whitelisted' })
    }

    const updated = [...existing, { name }]
    await writeWhitelist(id, updated)

    if (processManager.isRunning(id)) {
      processManager.sendCommand(id, `whitelist add ${name}`)
    }

    res.status(201).json({ id, entries: updated })
  } catch (error) {
    console.error(`Error adding whitelist entry for ${id}`, error)
    res.status(500).json({ error: 'Failed to update whitelist' })
  }
})

router.delete('/:id/whitelist/:name', async (req: Request, res: Response) => {
  const { id } = req.params
  const rawName = req.params.name ?? ''
  const name = sanitizeName(rawName)

  if (!name) {
    return res.status(400).json({ error: 'Player name is required' })
  }

  try {
    const instance = await ensureInstanceOr404(id, res)
    if (!instance) return

    const existing = await readWhitelist(id)
    const remaining = existing.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase())

    if (remaining.length === existing.length) {
      return res.status(404).json({ error: 'Player not found in whitelist' })
    }

    await writeWhitelist(id, remaining)

    if (processManager.isRunning(id)) {
      processManager.sendCommand(id, `whitelist remove ${name}`)
    }

    res.json({ id, entries: remaining })
  } catch (error) {
    console.error(`Error removing whitelist entry for ${id}`, error)
    res.status(500).json({ error: 'Failed to update whitelist' })
  }
})

export default router
