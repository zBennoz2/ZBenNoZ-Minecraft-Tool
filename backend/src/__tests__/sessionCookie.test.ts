import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Request } from 'express'
import { getSessionCookieOptions, isSecureRequest } from '../api/sessionCookie'

const request = (secure: boolean, forwardedProto?: string): Request => ({
  secure,
  headers: forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {},
} as Request)

test('auto mode sets Secure only for HTTPS and Cloudflare-forwarded HTTPS requests', () => {
  const previous = process.env.SESSION_COOKIE_SECURE
  process.env.SESSION_COOKIE_SECURE = 'auto'
  try {
    assert.equal(isSecureRequest(request(true)), true)
    assert.equal(isSecureRequest(request(false, 'https, http')), true)
    assert.equal(getSessionCookieOptions(request(false, 'https')).secure, true)
    assert.equal(getSessionCookieOptions(request(false)).secure, false)
  } finally {
    if (previous === undefined) delete process.env.SESSION_COOKIE_SECURE
    else process.env.SESSION_COOKIE_SECURE = previous
  }
})

test('secure override supports true and false', () => {
  const previous = process.env.SESSION_COOKIE_SECURE
  try {
    process.env.SESSION_COOKIE_SECURE = 'true'
    assert.equal(getSessionCookieOptions(request(false)).secure, true)
    process.env.SESSION_COOKIE_SECURE = 'false'
    assert.equal(getSessionCookieOptions(request(true)).secure, false)
  } finally {
    if (previous === undefined) delete process.env.SESSION_COOKIE_SECURE
    else process.env.SESSION_COOKIE_SECURE = previous
  }
})

test('cookie clearing options retain the attributes used to set the cookie', () => {
  const previous = process.env.SESSION_COOKIE_SECURE
  process.env.SESSION_COOKIE_SECURE = 'auto'
  try {
    const req = request(false, 'https')
    const setOptions = getSessionCookieOptions(req, '2030-01-01T00:00:00.000Z')
    const clearOptions = getSessionCookieOptions(req)
    assert.equal(setOptions.secure, clearOptions.secure)
    assert.equal(setOptions.sameSite, clearOptions.sameSite)
    assert.equal(setOptions.path, clearOptions.path)
    assert.equal(setOptions.httpOnly, clearOptions.httpOnly)
  } finally {
    if (previous === undefined) delete process.env.SESSION_COOKIE_SECURE
    else process.env.SESSION_COOKIE_SECURE = previous
  }
})
