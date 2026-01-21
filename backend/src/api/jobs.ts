import { Request, Response, Router } from 'express'
import { jobService } from '../services/job.service'

const router = Router()

router.get('/jobs/:jobId', (req: Request, res: Response) => {
  const job = jobService.getJob(req.params.jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  return res.json(job)
})

export default router
