import { Request, Response, Router } from 'express'
import { InstanceManager } from '../core/InstanceManager'
import { LogService } from '../core/LogService'
import { InstanceActionError } from '../core/InstanceActionError'
import { logStreamService } from '../services/logStream.service'
import { instanceActionService } from '../services/instanceActions.service'

const router = Router()
const instanceManager = new InstanceManager()
const logService = new LogService()

const handleActionError = (res: Response, error: unknown, context: string) => {
  if (error instanceof InstanceActionError) {
    return res.status(error.status).json(error.body)
  }
  console.error(context, error)
  return res.status(500).json({ error: 'Unexpected error' })
}

router.post('/:id/start', async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const result = await instanceActionService.start(id)
    return res.json(result)
  } catch (error) {
    return handleActionError(res, error, `Error starting instance ${id}`)
  }
})

router.post('/:id/command', async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const commandRaw = typeof req.body?.command === 'string' ? req.body.command : ''
    const result = await instanceActionService.sendCommand(id, commandRaw)
    return res.json(result)
  } catch (error) {
    return handleActionError(res, error, `Error sending command for instance ${id}`)
  }
})

router.post('/:id/stop', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const result = await instanceActionService.stop(id)
    return res.json(result)
  } catch (error) {
    return handleActionError(res, error, `Error stopping instance ${id}`)
  }
})

router.post('/:id/restart', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const result = await instanceActionService.restart(id)
    return res.json(result)
  } catch (error) {
    return handleActionError(res, error, `Error restarting instance ${id}`)
  }
})

router.get('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const current = await instanceActionService.status(id)
    return res.json(current)
  } catch (error) {
    return handleActionError(res, error, `Error fetching status for instance ${id}`)
  }
})

router.get('/:id/logs/stream', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' })
    }

    logStreamService.subscribe(id, res)
  } catch (error) {
    console.error(`Error streaming logs for instance ${id}`, error)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to stream instance logs' })
    }
    res.end()
  }
})

router.get('/:id/logs', async (req: Request, res: Response) => {
  const { id } = req.params
  const linesParam = req.query.lines as string | undefined
  const sourceParam = (req.query.source as string | undefined) ?? 'server'
  const defaultLines = 200
  const maxLines = 2000

  try {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' })
    }

    let lines = defaultLines
    if (linesParam !== undefined) {
      const parsed = Number.parseInt(linesParam, 10)
      if (Number.isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'lines must be a positive integer' })
      }
      lines = Math.min(parsed, maxLines)
    }

    const source = sourceParam === 'prepare' ? 'prepare' : 'server'
    const content = await logService.readTail(id, lines, source)
    return res.json({ id, lines, source, content })
  } catch (error) {
    console.error(`Error reading logs for instance ${id}`, error)
    return res.status(500).json({ error: 'Failed to read instance logs' })
  }
})

export default router
