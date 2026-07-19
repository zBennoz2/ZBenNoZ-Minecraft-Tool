import { NextFunction, Request, Response } from 'express'
import { localUsersService, type LocalUser } from '../services/localUsers.service'

declare global { namespace Express { interface Request { user?: LocalUser } } }
const parseCookies = (header?: string) => Object.fromEntries((header || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))] }))
export const getSessionToken = (req: Request) => parseCookies(req.header('cookie')).zbn_session || req.header('authorization')?.replace(/^Bearer\s+/i, '')
const isAdminUser = (user?: LocalUser | null) => user?.role === 'admin'
const sessionErrorMessages: Record<string, string> = {
  SESSION_COOKIE_MISSING: 'Das Session-Cookie wurde nicht übertragen.',
  SESSION_NOT_FOUND: 'Die lokale Sitzung wurde nicht gefunden.',
  SESSION_EXPIRED: 'Die Sitzung ist abgelaufen.',
  USER_NOT_FOUND: 'Der Benutzer der lokalen Sitzung wurde nicht gefunden.',
  USER_DISABLED: 'Der Benutzer der lokalen Sitzung ist deaktiviert.',
}
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const lookup = await localUsersService.inspectSession(getSessionToken(req))
  if (lookup.status !== 'OK' || !lookup.user) {
    return res.status(401).json({ error: lookup.status, message: sessionErrorMessages[lookup.status] || 'Login erforderlich.' })
  }
  req.user = lookup.user
  return next()
}
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => { if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Login erforderlich.' }); return isAdminUser(req.user) ? next() : res.status(403).json({ error: 'ADMIN_REQUIRED', message: 'Adminrechte erforderlich.' }) }
export const requireInstanceAccess = async (req: Request, res: Response, next: NextFunction) => { const id = req.params.id; if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Login erforderlich.' }); if (isAdminUser(req.user) || !id || await localUsersService.hasInstanceAccess(req.user, id)) return next(); return res.status(403).json({ error: 'INSTANCE_ACCESS_DENIED', message: 'Keine Berechtigung für diese Instanz.' }) }

export const requireResourceAdmin = (req: Request, res: Response, next: NextFunction) => { if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Login erforderlich.' }); return isAdminUser(req.user) ? next() : res.status(403).json({ error: 'RESOURCE_ADMIN_REQUIRED', message: 'Nur Admins dürfen RAM/Ressourcen ändern.' }) }
