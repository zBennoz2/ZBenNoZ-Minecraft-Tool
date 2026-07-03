import express from 'express'
import { getLicenseStatus, licenseGuardMiddleware } from '../services/licenseStatus.service'

const router = express.Router()

router.get('/status', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true'
  const status = await getLicenseStatus({ force })
  res.json({
    ...status,
    valid: status.active || status.status === 'grace',
    source: status.source ?? 'system_admin',
    checkedAt: status.licenseCheckedAt ?? status.checked_at ?? new Date().toISOString(),
    message: status.active || status.status === 'grace' ? 'Global license valid' : status.message ?? 'Die globale Softwarelizenz ist ungültig oder nicht verfügbar. Bitte Admin kontaktieren.',
  })
})

export { licenseGuardMiddleware }
export default router
