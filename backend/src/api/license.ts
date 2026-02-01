import express from 'express'
import { getLicenseStatus, licenseGuardMiddleware } from '../services/licenseStatus.service'

const router = express.Router()

router.get('/status', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true'
  const status = await getLicenseStatus({ force })
  res.json(status)
})

export { licenseGuardMiddleware }
export default router
