import express from 'express'
import { getSession as getRemoteSession, login as remoteLogin, logout as remoteLogout, resetSession } from '../services/auth.service'
import { clearLicenseStatusCache, getCachedLicenseStatus, getGlobalLicenseStatus, getLicenseStatus } from '../services/licenseStatus.service'
import { localUsersService, verifyPassword, type SafeUser } from '../services/localUsers.service'
import { getSessionToken } from './authz'

const router = express.Router()
const cookieName = 'zbn_session'
const setSessionCookie = (res: express.Response, token: string, expiresAt: string) => { const parts = [`${cookieName}=${encodeURIComponent(token)}`, 'Path=/', 'SameSite=Lax', 'HttpOnly', `Expires=${new Date(expiresAt).toUTCString()}`]; if (process.env.NODE_ENV === 'production') parts.push('Secure'); res.setHeader('Set-Cookie', parts.join('; ')) }
const clearSessionCookie = (res: express.Response) => res.setHeader('Set-Cookie', `${cookieName}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`)
const safeUser = (user: any) => user ? { id: user.id, username: user.username, name: user.username, role: user.role, isAdmin: user.role === 'admin', createdAt: user.createdAt, updatedAt: user.updatedAt } : undefined
const authPayload = (user: SafeUser, extra: Record<string, unknown> = {}) => ({
  authenticated: true,
  role: user.role,
  isAdmin: user.role === 'admin',
  userId: user.id,
  username: user.username,
  displayName: user.username,
  user: safeUser(user),
  ...extra,
})

router.get('/session', async (req, res) => {
  const localUser = await localUsersService.getUserBySession(getSessionToken(req))
  const license = getCachedLicenseStatus()
  if (localUser) return res.json(authPayload(localUser, { license }))
  const remote = await getRemoteSession()
  if (remote.authenticated) {
    const user = await localUsersService.ensureLicenseAdmin(remote.user?.name || remote.user?.email || remote.user?.id)
    return res.json(authPayload(user, { license, device: remote.device }))
  }
  res.json({ ...remote, license })
})
router.get('/setup', async (_req, res) => res.json({ needsInitialAdmin: !(await localUsersService.hasUsers()) }))
router.post('/setup', async (req, res) => { if (await localUsersService.hasUsers()) return res.status(403).json({ error: 'SETUP_CLOSED' }); const { username, password } = req.body ?? {}; if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'INVALID_USER_INPUT' }); const user = await localUsersService.createUser({ username, password, role: 'admin' }); const session = await localUsersService.createSession(user.id, true); setSessionCookie(res, session.token, session.expiresAt); res.status(201).json({ ok: true, ...authPayload(user) }) })
router.post('/login', async (req, res) => { const { identifier, password, remember } = req.body as { identifier?: string; password?: string; remember?: boolean }; const localUser = identifier ? await localUsersService.findByUsername(identifier) : null; if (localUser) { if (localUser.disabled || !(await verifyPassword(password || '', localUser.passwordHash))) return res.status(401).json({ error: 'LOGIN_FAILED', message: 'Login fehlgeschlagen.' }); const license = await getGlobalLicenseStatus(); if (!license.active && license.status !== 'grace') return res.status(403).json({ error: 'GLOBAL_LICENSE_INVALID', message: license.message || 'Die globale Softwarelizenz ist ungültig oder nicht verfügbar. Bitte Admin kontaktieren.', license: { valid: false, source: 'system_admin', checkedAt: license.licenseCheckedAt ?? license.checked_at, message: license.message } }); const session = await localUsersService.createSession(localUser.id, remember); setSessionCookie(res, session.token, session.expiresAt); return res.json({ ok: true, ...authPayload(localUser, { license }) }) } const result = await remoteLogin({ identifier: identifier || '', password: password || '', remember }); if (!result.ok) return res.status(result.status ?? 401).json({ error: result.error ?? 'LOGIN_FAILED', message: result.message, device_limit: result.device_limit, devices_used: result.devices_used }); const license = await getLicenseStatus({ force: true }); if (!license.active && license.status !== 'grace') return res.status(403).json({ error: 'GLOBAL_LICENSE_INVALID', message: 'Die globale Softwarelizenz ist ungültig oder nicht verfügbar. Bitte Admin kontaktieren.' }); const user = await localUsersService.ensureLicenseAdmin(result.user?.name || result.user?.email || result.user?.id); const session = await localUsersService.createSession(user.id, remember); setSessionCookie(res, session.token, session.expiresAt); return res.json({ ok: true, ...authPayload(user, { license }) }) })
router.post('/logout', async (req, res) => { const token = getSessionToken(req); const user = await localUsersService.getUserBySession(token); await localUsersService.destroySession(token); if (!user || user.role === 'admin') { await remoteLogout(); clearLicenseStatusCache(); } clearSessionCookie(res); res.json({ ok: true }) })
router.post('/reset', async (req, res) => { await localUsersService.destroySession(getSessionToken(req)); clearSessionCookie(res); const result = await resetSession(); const licenseCache = clearLicenseStatusCache(); res.json({ ok: true, ...result, licenseCacheDeleted: licenseCache.deleted }) })
export default router
