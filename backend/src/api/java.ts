import { Request, Response, Router } from 'express'
import {
  detectJavaCandidates,
  getRecommendedJavaMajor,
  javaInstallManager,
  JavaInstallEvent,
} from '../services/java.service'

const router = Router()

router.get('/java/recommendation', (req: Request, res: Response) => {
  const mcVersion = (req.query.mcVersion as string) ?? ''
  const serverType = (req.query.serverType as string) ?? undefined
  const recommendedMajor = getRecommendedJavaMajor(mcVersion, serverType)
  return res.json({ recommendedMajor })
})

router.get('/java/detect', async (_req: Request, res: Response) => {
  try {
    const candidates = await detectJavaCandidates()
    return res.json({ candidates })
  } catch (error) {
    console.error('Failed to detect Java', error)
    return res.status(500).json({ error: 'Failed to detect Java runtimes' })
  }
})

router.post('/java/install', async (req: Request, res: Response) => {
  const major = Number(req.body?.major)
  if (!Number.isFinite(major) || major <= 0) {
    return res.status(400).json({ error: 'major is required' })
  }

  try {
    const result = await javaInstallManager.ensureInstalled(major)
    return res.json(result)
  } catch (error) {
    console.error('Failed to start Java install', error)
    return res.status(500).json({ error: 'Failed to start Java installation' })
  }
})

router.get('/java/install/stream', (req: Request, res: Response) => {
  const jobId = (req.query.jobId as string) ?? ''
  const job = javaInstallManager.getJob(jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const sendEvent = (event: JavaInstallEvent) => {
    res.write(`event: java_install\ndata: ${JSON.stringify(event)}\n\n`)
  }

  const unsubscribe = job.on(sendEvent)

  res.on('close', () => {
    unsubscribe()
    res.end()
  })
  res.on('error', () => {
    unsubscribe()
    res.end()
  })
})

export default router
