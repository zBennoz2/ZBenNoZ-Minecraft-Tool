import express from 'express'
import { getSession, login, logout } from '../services/auth.service'
import { getCachedLicenseStatus } from '../services/licenseStatus.service'

const router = express.Router()

router.get('/session', async (_req, res) => {
  const session = await getSession()
  const license = getCachedLicenseStatus()
  res.json({ ...session, license })
})

router.post('/login', async (req, res) => {
  const { identifier, password, remember } = req.body as {
    identifier?: string
    password?: string
    remember?: boolean
  }
  const result = await login({ identifier: identifier || '', password: password || '', remember })
  if (!result.ok) {
    return res.status(result.status ?? 401).json({
      error: result.error ?? 'LOGIN_FAILED',
      message: result.message,
      device_limit: result.device_limit,
      devices_used: result.devices_used,
    })
  }
  return res.json({ ok: true, user: result.user })
})

router.post('/logout', async (_req, res) => {
  await logout()
  res.json({ ok: true })
})

export default router
