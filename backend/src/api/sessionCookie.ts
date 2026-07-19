import type { CookieOptions, Request } from 'express'

type SameSite = 'lax' | 'none' | 'strict'
type SecureCookieMode = 'auto' | 'true' | 'false'

const configuredSameSite = (): SameSite => {
  const value = process.env.SESSION_COOKIE_SAME_SITE?.trim().toLowerCase()
  return value === 'lax' || value === 'none' || value === 'strict' ? value : 'lax'
}

const configuredSecureMode = (): SecureCookieMode => {
  const value = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase()
  return value === 'true' || value === 'false' || value === 'auto' ? value : 'auto'
}

/** Returns whether this individual request reached the browser over HTTPS. */
export const isSecureRequest = (req: Request): boolean => {
  if (req.secure === true) return true

  const forwardedProto = req.headers['x-forwarded-proto']
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
  return typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https'
}

/**
 * Builds the cookie attributes from the request that created or clears it.
 * In auto mode, HTTPS clients receive Secure cookies while local HTTP clients do not.
 */
export const getSessionCookieOptions = (req: Request, expiresAt?: string): CookieOptions => {
  const secureMode = configuredSecureMode()
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim()

  return {
    httpOnly: true,
    secure: secureMode === 'auto' ? isSecureRequest(req) : secureMode === 'true',
    sameSite: configuredSameSite(),
    path: '/',
    ...(domain ? { domain } : {}),
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  }
}
