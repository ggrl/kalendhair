import { assertKnownTimeZone } from '../src/calendar/salon-date.js'
import { whyPasswordUnusable, whyPinUnusable } from './credentials.js'

export interface Config {
  databaseUrl: string
  salonTimeZone: string
  host: string
  port: number
  /** Signs the session cookie. ADR-0004 keeps this in the environment, and ADR-0017 leaves it there. */
  sessionSecret: string
  /** ADR-0017: opens the reset screen and nothing else. Never a board session. */
  masterPassword: string
  /** ADR-0017: seeds the credential row when it is absent, and is ignored once it exists. */
  salonPassword: string
  /** The same, for the PIN that guards the settings screen. */
  salonPin: string
  /** Whether the session cookie is marked Secure. Derived, not configured - see below. */
  cookieSecure: boolean
}

/**
 * A secret short enough to guess is not a secret, and a cookie signed with one can be forged
 * by anybody who guesses it - silently, because everything else about the server keeps working.
 * Thirty-two characters is what `openssl rand -base64 24` produces.
 */
export const MINIMUM_SESSION_SECRET_LENGTH = 32

/**
 * Reads configuration and refuses to start without it. No fallback for the database or
 * the timezone: a guessed connection string fails obviously, but a guessed timezone
 * produces a board that is quietly a day out for part of every night.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = required(env, 'DATABASE_URL')
  const salonTimeZone = required(env, 'SALON_TIMEZONE')
  assertKnownTimeZone(salonTimeZone)

  // ADR-0004 is settled now: the board is behind a password, so the bind address is no longer
  // the only thing keeping customer names private. Loopback stays the default anyway, because
  // stage one has no TLS and reaching the box is still a deliberate act.
  //
  // `??` alone was a hole: it catches undefined but not `HOST=`, and Node resolves
  // listen(port, '') to `::`, which is every interface. An empty line in .env would have
  // published the login screen and every session cookie on the box's public address while the
  // startup banner still said loopback. Empty means unset here, exactly as it does above.
  const host = env.HOST === undefined || env.HOST.trim() === '' ? '127.0.0.1' : env.HOST.trim()

  const port = Number(env.PORT ?? '3000')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT is not a usable port number: ${String(env.PORT)}`)
  }

  const sessionSecret = required(env, 'SESSION_SECRET')
  if (sessionSecret.length < MINIMUM_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MINIMUM_SESSION_SECRET_LENGTH} characters, ` +
        'because it is the only thing standing between a browser and a session it did not earn',
    )
  }

  // ADR-0017: four names, four reasons to refuse to start, and the reason is said out loud.
  // The seeds stay required after the row exists, so that a machine can never be brought up
  // with two of the three credentials and no way to notice the third was never set.
  const masterPassword = usable(env, 'MASTER_PASSWORD', whyPasswordUnusable)
  const salonPassword = usable(env, 'SALON_PASSWORD', whyPasswordUnusable)
  const salonPin = usable(env, 'SALON_PIN', whyPinUnusable)

  return {
    databaseUrl,
    salonTimeZone,
    host,
    port,
    sessionSecret,
    masterPassword,
    salonPassword,
    salonPin,
    // Derived from the bind address rather than given a name of its own.
    //
    // A Secure cookie is dropped by the browser over plain HTTP, so marking it always would
    // make stage one - loopback, no TLS - impossible to log in to. Marking it never would send
    // the session cookie in clear text the day this reaches a VPS. The product brief says the
    // move off loopback is the move behind HTTPS, so the bind address is the honest signal.
    //
    // What it costs if that stops being true: a server bound to a public address with no TLS
    // in front refuses every login, because the browser accepts the cookie and never sends it
    // back. That fails closed and visibly, which is the right direction to be wrong in.
    cookieSecure: host !== '127.0.0.1' && host !== 'localhost' && host !== '::1',
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required and was not set`)
  }
  return value
}

/**
 * A secret that is present and passes the rule the screen enforces on it.
 *
 * The reason is German because it is written for the person changing the password, and this
 * check exists so that one rule has one home - the alternative is an environment that can seed
 * a password the settings screen would then refuse to let anybody set again.
 */
function usable(env: NodeJS.ProcessEnv, name: string, why: (value: string) => string | null): string {
  const value = required(env, name)
  const reason = why(value)
  if (reason !== null) throw new Error(`${name} is not usable: ${reason}`)
  return value
}
