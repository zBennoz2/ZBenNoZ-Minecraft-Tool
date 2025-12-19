import express from 'express'
import { activateLicense, deleteLicense, getDeviceFingerprintHash, getLicenseStatus, licenseGuardMiddleware } from '../services/license.service'

const router = express.Router()

router.get('/status', (_req, res) => {
  const status = getLicenseStatus()
  res.json({ ...status, deviceHash: getDeviceFingerprintHash() })
})

router.post('/activate', (req, res) => {
  const { licenseToken } = req.body as { licenseToken?: string }
  const result = activateLicense(licenseToken || '')
  if (!result.ok) {
    return res
      .status(result.statusCode ?? 400)
      .json({ error: result.error, message: result.message, status: result.status })
  }

  return res.json({ ...result.status, deviceHash: getDeviceFingerprintHash() })
})

router.delete('/', (_req, res) => {
  deleteLicense()
  res.json({ ok: true })
})

export { licenseGuardMiddleware }
export default router
