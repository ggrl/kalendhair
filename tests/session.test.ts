import { describe, expect, it } from 'vitest'
import {
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  issueSession,
  readSession,
  sessionCookieFrom,
  shouldRefresh,
} from '../server/session.js'

const SECRET = 'not-a-secret-a-published-test-signing-key'
const NOW = Date.parse('2026-08-13T09:00:00Z')

describe('issueSession and readSession', () => {
  it('reads back what it wrote', () => {
    const session = readSession(SECRET, issueSession(SECRET, 7, NOW), NOW)
    expect(session).toEqual({ version: 7, expiresAt: NOW + SESSION_LIFETIME_MS })
  })

  it('refuses a cookie signed with another secret', () => {
    // The whole point of signing. Without it the browser writes its own session.
    expect(readSession(SECRET, issueSession('another-signing-key-entirely-x', 1, NOW), NOW)).toBeNull()
  })

  it('refuses a payload that was edited under its own signature', () => {
    const issued = issueSession(SECRET, 1, NOW)
    const [payload, signature] = issued.split('.')

    // The obvious attack: keep the signature, raise the version so a password change stops
    // logging you out. base64url of {"v":9,"e":...} rather than {"v":1,...}.
    const forged = Buffer.from(JSON.stringify({ v: 9, e: NOW + SESSION_LIFETIME_MS })).toString('base64url')
    expect(forged).not.toBe(payload)
    expect(readSession(SECRET, `${forged}.${signature}`, NOW)).toBeNull()
  })

  it('refuses rubbish rather than throwing at it', () => {
    // A cookie header is whatever the client sends. Each of these used to be a way to make the
    // server answer with a 500 instead of a login screen.
    for (const value of ['', '.', 'nodot', 'a.b', '....', Buffer.from('null').toString('base64url') + '.x']) {
      expect(readSession(SECRET, value, NOW)).toBeNull()
    }
  })

  it('stops counting the moment it expires', () => {
    const issued = issueSession(SECRET, 1, NOW)
    expect(readSession(SECRET, issued, NOW + SESSION_LIFETIME_MS - 1)).not.toBeNull()
    expect(readSession(SECRET, issued, NOW + SESSION_LIFETIME_MS)).toBeNull()
  })
})

describe('shouldRefresh', () => {
  it('leaves a fresh session alone and renews one that has been carried a while', () => {
    const session = { version: 1, expiresAt: NOW + SESSION_LIFETIME_MS }

    expect(shouldRefresh(session, NOW)).toBe(false)
    expect(shouldRefresh(session, NOW + 60_000)).toBe(false)
    // A day in. The expiry slides on use, which is what stops the password being asked for
    // mid-shift by somebody who has had the board open all month.
    expect(shouldRefresh(session, NOW + 25 * 60 * 60 * 1000)).toBe(true)
  })
})

describe('sessionCookieFrom', () => {
  it('finds the session among other cookies, and answers null when there is none', () => {
    expect(sessionCookieFrom(`${SESSION_COOKIE}=abc.def`)).toBe('abc.def')
    expect(sessionCookieFrom(`other=1; ${SESSION_COOKIE}=abc.def; third=2`)).toBe('abc.def')
    expect(sessionCookieFrom(undefined)).toBeNull()
    expect(sessionCookieFrom('other=1')).toBeNull()
    // A prefix match would take `not_salon_session` for the real one.
    expect(sessionCookieFrom(`not_${SESSION_COOKIE}=abc.def`)).toBeNull()
  })
})
