import express from 'express'
import { login as remoteLogin, resetSession } from '../services/auth.service'
import { clearLicenseStatusCache, getCachedLicenseStatus, getGlobalLicenseStatus, getLicenseStatus } from '../services/licenseStatus.service'
import { localUsersService, verifyPassword, type SafeUser } from '../services/localUsers.service'
import { getSessionToken } from './authz'

const router = express.Router()
const cookieName = 'zbn_session'
type SameSite = 'lax' | 'none' | 'strict'

const isHttpsRequest = (req: express.Request) =>
  req.secure || req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() === 'https'

const configuredSameSite = (): SameSite => {
  const value = process.env.SESSION_COOKIE_SAME_SITE?.trim().toLowerCase()
  if (value === 'lax' || value === 'none' || value === 'strict') return value
  // A separately hosted panel must opt in via SESSION_COOKIE_SAME_SITE=none.
  return 'lax'
}

const cookieOptions = (expiresAt?: string): express.CookieOptions => {
  const sameSite = configuredSameSite()
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim()
  const secure = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase() !== 'false'
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    ...(domain ? { domain } : {}),
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  }
}

const setSessionCookie = (res: express.Response, token: string, expiresAt: string) => {
  res.cookie(cookieName, token, cookieOptions(expiresAt))
}
const clearSessionCookie = (res: express.Response) => res.clearCookie(cookieName, cookieOptions())
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

const sessionErrorMessage: Record<string, string> = {
  SESSION_COOKIE_MISSING: 'Das Session-Cookie wurde nicht übertragen.',
  SESSION_NOT_FOUND: 'Die lokale Sitzung wurde nicht gefunden oder das Session-Cookie wurde nicht übertragen.',
  SESSION_EXPIRED: 'Die Sitzung ist abgelaufen.',
  USER_NOT_FOUND: 'Der Benutzer der lokalen Sitzung wurde nicht gefunden.',
  USER_DISABLED: 'Der Benutzer der lokalen Sitzung ist deaktiviert.',
}

const logSession = (event: string, req: express.Request, details: Record<string, unknown>) => {
  console.info(`[auth] ${event}`, {
    ...details,
    publicHttps: isHttpsRequest(req),
    origin: req.header('origin') || undefined,
  })
}

const getCurrentSession = async (req: express.Request, res: express.Response) => {
  const lookup = await localUsersService.inspectSession(getSessionToken(req))
  logSession('Session geprüft', req, {
    cookiePresent: lookup.status !== 'SESSION_COOKIE_MISSING',
    sessionFound: !['SESSION_COOKIE_MISSING', 'SESSION_NOT_FOUND'].includes(lookup.status),
    userFound: Boolean(lookup.user),
    role: lookup.user?.role,
  })
  const license = getCachedLicenseStatus()
  if (lookup.status !== 'OK' || !lookup.user) {
    return res.status(401).json({ authenticated: false, error: lookup.status, message: sessionErrorMessage[lookup.status], license })
  }
  return res.json(authPayload(lookup.user, { license }))
}

const createAndSetSession = async (req: express.Request, res: express.Response, user: SafeUser, remember: boolean) => {
  const session = await localUsersService.createSession(user.id, remember)
  setSessionCookie(res, session.token, session.expiresAt)
  logSession('Login-Session erstellt', req, {
    sessionCreated: true,
    userId: user.id,
    role: user.role,
    cookieSet: true,
    cookieSecure: cookieOptions().secure,
    cookieSameSite: cookieOptions().sameSite,
  })
}

router.get('/session', getCurrentSession)
router.get('/me', getCurrentSession)
router.get('/setup', async (_req, res) => res.json({ needsInitialAdmin: !(await localUsersService.hasUsers()) }))
router.post('/setup', async (req, res) => {
  if (await localUsersService.hasUsers()) return res.status(403).json({ error: 'SETUP_CLOSED' })
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'INVALID_USER_INPUT' })
  const user = await localUsersService.createUser({ username, password, role: 'admin' })
  await createAndSetSession(req, res, user, true)
  return res.status(201).json({ ok: true, ...authPayload(user) })
})
router.post('/login', async (req, res) => {
  const { identifier, password, remember } = req.body as { identifier?: string; password?: string; remember?: boolean }
  const localUser = identifier ? await localUsersService.findByUsername(identifier) : null
  if (localUser) {
    if (localUser.disabled || !(await verifyPassword(password || '', localUser.passwordHash))) return res.status(401).json({ error: 'LOGIN_FAILED', message: 'Login fehlgeschlagen.' })
    const license = await getGlobalLicenseStatus()
    if (!license.active && license.status !== 'grace') return res.status(403).json({ error: 'GLOBAL_LICENSE_INVALID', message: license.message || 'Die globale Softwarelizenz ist ungültig oder nicht verfügbar. Bitte Admin kontaktieren.', license: { valid: false, source: 'system_admin', checkedAt: license.licenseCheckedAt ?? license.checked_at, message: license.message } })
    await createAndSetSession(req, res, localUser, Boolean(remember))
    return res.json({ ok: true, ...authPayload(localUser, { license }) })
  }
  const result = await remoteLogin({ identifier: identifier || '', password: password || '', remember })
  if (!result.ok) return res.status(result.status ?? 401).json({ error: result.error ?? 'LOGIN_FAILED', message: result.message, device_limit: result.device_limit, devices_used: result.devices_used })
  const license = await getLicenseStatus({ force: true })
  if (!license.active && license.status !== 'grace') return res.status(403).json({ error: 'GLOBAL_LICENSE_INVALID', message: 'Die globale Softwarelizenz ist ungültig oder nicht verfügbar. Bitte Admin kontaktieren.' })
  const user = await localUsersService.ensureLicenseAdmin(result.user?.name || result.user?.email || result.user?.id)
  await createAndSetSession(req, res, user, Boolean(remember))
  return res.json({ ok: true, ...authPayload(user, { license }) })
})
router.post('/logout', async (req, res) => { await localUsersService.destroySession(getSessionToken(req)); clearSessionCookie(res); res.json({ ok: true }) })
router.post('/reset', async (req, res) => { await localUsersService.destroySession(getSessionToken(req)); clearSessionCookie(res); const result = await resetSession(); const licenseCache = clearLicenseStatusCache(); res.json({ ok: true, ...result, licenseCacheDeleted: licenseCache.deleted }) })
export default router
