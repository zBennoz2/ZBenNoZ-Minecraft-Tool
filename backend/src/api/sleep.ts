import { Router } from 'express'
import { sleepService } from '../services/sleep.service'

const router = Router({ mergeParams: true })

router.get('/:id/sleep-settings', async (req, res) => {
  try {
    const settings = await sleepService.getSettingsForInstance(req.params.id)
    if (!settings) return res.status(404).json({ error: 'Instance not found' })
    res.json(settings)
  } catch (error) {
    console.error('sleep settings fetch failed', error)
    res.status(500).json({ error: 'Failed to load sleep settings' })
  }
})

router.patch('/:id/sleep-settings', async (req, res) => {
  try {
    const settings = await sleepService.updateSettings(req.params.id, req.body ?? {})
    if (!settings) return res.status(404).json({ error: 'Instance not found' })
    res.json(settings)
  } catch (error) {
    console.error('sleep settings update failed', error)
    res.status(500).json({ error: 'Failed to update sleep settings' })
  }
})

router.get('/:id/sleep-status', async (req, res) => {
  try {
    const status = await sleepService.getStatus(req.params.id)
    if (!status) return res.status(404).json({ error: 'Instance not found' })
    res.json(status)
  } catch (error) {
    console.error('sleep status failed', error)
    res.status(500).json({ error: 'Failed to load sleep status' })
  }
})

export default router
