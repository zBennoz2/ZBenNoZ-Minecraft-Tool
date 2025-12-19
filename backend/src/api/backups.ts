import { Router } from 'express'
import { backupService } from '../services/backup.service'
import { jobService } from '../services/job.service'

const router = Router({ mergeParams: true })

router.get('/:id/backups', async (req, res) => {
  try {
    const list = await backupService.listBackups(req.params.id)
    res.json(list)
  } catch (error) {
    console.error('list backups failed', error)
    res.status(500).json({ error: 'Failed to list backups' })
  }
})

router.post('/:id/backups', async (req, res) => {
  const format = (req.body?.format as string) || undefined
  try {
    const result = await backupService.createBackup(req.params.id, format)
    if (result.status !== 202) {
      return res.status(result.status).json({ error: result.message })
    }
    res.status(202).json({ jobId: result.jobId })
  } catch (error) {
    console.error('create backup failed', error)
    res.status(500).json({ error: 'Failed to start backup' })
  }
})

router.get('/:id/backups/jobs/:jobId', (req, res) => {
  const job = jobService.getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  res.json(job)
})

router.get('/:id/backups/:backupId/download', async (req, res) => {
  try {
    const file = await backupService.streamBackup(req.params.id, req.params.backupId)
    if (!file) return res.status(404).json({ error: 'Backup not found' })
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', file.size.toString())
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.backupId}"`)
    file.stream.pipe(res)
  } catch (error) {
    console.error('download backup failed', error)
    res.status(500).json({ error: 'Failed to download backup' })
  }
})

router.delete('/:id/backups/:backupId', async (req, res) => {
  try {
    const deleted = await backupService.deleteBackup(req.params.id, req.params.backupId)
    if (!deleted) return res.status(404).json({ error: 'Backup not found' })
    res.status(204).send()
  } catch (error) {
    console.error('delete backup failed', error)
    res.status(500).json({ error: 'Failed to delete backup' })
  }
})

router.post('/:id/backups/:backupId/restore', async (req, res) => {
  const forceStop = Boolean(req.body?.forceStop)
  const preRestoreSnapshot = Boolean(req.body?.preRestoreSnapshot)
  const autoStart = Boolean(req.body?.autoStart)
  try {
    const result = await backupService.restore(req.params.id, req.params.backupId, {
      forceStop,
      preRestoreSnapshot,
      autoStart,
    })
    if (result.status !== 202) {
      return res.status(result.status).json({ error: result.message })
    }
    res.status(202).json({ jobId: result.jobId })
  } catch (error) {
    console.error('restore backup failed', error)
    res.status(500).json({ error: 'Failed to start restore' })
  }
})

export default router
