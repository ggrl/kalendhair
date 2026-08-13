import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The signed session cookie: what is in it, how it is signed, and when it stops counting.
 *
 * ADR-0004 buys a signed httpOnly cookie with the salon password. ADR-0017 adds the one field
 * that makes a password change mean something - the credential version the cookie was issued
 * under, which the server compares against the row on every request.
 *
 * The cookie carries no customer data and no identity, because there is none: everybody is the
 * same session. It is a claim that somebody knew the password at a point in time, signed so it
 * cannot be written by the browser holding it.
 */

export const SESSION_COOKIE = 'salon_session'

/** Thirty days, chosen by the owner: the password is typed once a month at most. */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How much of that life is spent before a request gets a fresh cookie.
 *
 * The expiry slides, so nobody is asked for the password while they are using the board - but
 * re-issuing on every request would put a Set-Cookie header on every response for no gain.
 */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

export interface Session {
  /** The credential version this cookie was issued under. */
  version: number
  /** Milliseconds since the epoch. */
  expiresAt: number
}

/** A signed cookie value: the payload, a dot, and the signature over it. */
export function issueSession(secret: string, version: number, now: number): string {
  const payload = encode({ version, expiresAt: now + SESSION_LIFETIME_MS })
  return `${payload}.${sign(secret, payload)}`
}

/**
 * The session a cookie value stands for, or null if it was not signed by this secret, was
 * altered, is unreadable, or has run out.
 *
 * Null for every one of those on purpose. The caller's only sensible response to any of them
 * is the login screen, and telling a caller which of them it was tells an attacker whether
 * their forgery was well formed.
 */
export function readSession(secret: string, value: string, now: number): Session | null {
  const dot = value.lastIndexOf('.')
  if (dot === -1) return null

  const payload = value.slice(0, dot)
  const signature = value.slice(dot + 1)

  const expected = Buffer.from(sign(secret, payload))
  const given = Buffer.from(signature)
  // timingSafeEqual throws when the lengths differ, and a wrong length is already a wrong
  // signature - there is nothing to compare in constant time.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  const session = decode(payload)
  if (session === null || session.expiresAt <= now) return null
  return session
}

/** Whether this request should carry a fresh cookie, so that use keeps the session alive. */
export function shouldRefresh(session: Session, now: number): boolean {
  return session.expiresAt - now < SESSION_LIFETIME_MS - REFRESH_AFTER_MS
}

/**
 * The session cookie out of a Cookie header.
 *
 * Hand-parsed rather than adding cookie-parser: this reads one cookie whose value is base64url
 * and a dot, so there is nothing to unescape and nothing else in the header to care about.
 */
export function sessionCookieFrom(header: string | undefined): string | null {
  if (header === undefined) return null

  for (const part of header.split(';')) {
    const equals = part.indexOf('=')
    if (equals === -1) continue
    if (part.slice(0, equals).trim() === SESSION_COOKIE) return part.slice(equals + 1).trim()
  }
  return null
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function encode(session: Session): string {
  return Buffer.from(JSON.stringify({ v: session.version, e: session.expiresAt })).toString('base64url')
}

/** The payload back, or null for anything that is not the object this module writes. */
function decode(payload: string): Session | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null

    const { v, e } = parsed as { v?: unknown; e?: unknown }
    if (!Number.isInteger(v) || !Number.isInteger(e)) return null
    return { version: v as number, expiresAt: e as number }
  } catch {
    // Not base64url, not JSON. The signature already said this cookie is ours, so this is a
    // corrupted value rather than a forgery - and it is still nobody's session.
    return null
  }
}
