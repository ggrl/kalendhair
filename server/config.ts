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
  /**
   * How many proxy hops in front of this server may be believed about who the caller is.
   * `0` means none, which is the default and the safe answer - see below.
   */
  trustProxy: number
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
    cookieSecure: cookieSecureFrom(env, host),
    trustProxy: trustProxyFrom(env),
  }
}

/**
 * How many hops of `X-Forwarded-For` this server may believe.
 *
 * Three counters in `app.ts` are keyed on the caller's address: login, the master-password
 * reset, and wrong PIN attempts. Behind a proxy Express has not been told to trust, every
 * request carries the proxy's address, so all three stop being per-visitor and become one
 * budget shared by the whole internet - a stranger sending 21 login attempts every five
 * minutes holds the salon out of its own board, and out of the recovery door with it.
 *
 * **The default is 0 and it has to be**, because the fix is worse than the problem when it is
 * wrong in the other direction. Measured on Express 5: with `trust proxy` set to `1`, a direct
 * request carrying `X-Forwarded-For: 9.9.9.9` gets `request.ip === '9.9.9.9'`. So on a machine
 * where anything can reach this port directly - a laptop, or a box before the proxy is set up -
 * trusting a hop hands every limiter to the caller. Off unless somebody says otherwise.
 *
 * A count, never a boolean. `trust proxy: true` trusts the whole chain, which means the leftmost
 * `X-Forwarded-For` entry is whatever the caller wrote, and the limiters are gone rather than
 * fixed. `true` and `false` are therefore refused by name rather than coerced, because somebody
 * will reach for them.
 */
function trustProxyFrom(env: NodeJS.ProcessEnv): number {
  const given = env.TRUST_PROXY?.trim()
  if (given === undefined || given === '') return 0

  if (given.toLowerCase() === 'true' || given.toLowerCase() === 'false') {
    throw new Error(
      'TRUST_PROXY is a number of proxy hops, not true or false. One proxy in front of this ' +
        'server is TRUST_PROXY=1; none is leaving it unset. "true" would trust the whole ' +
        'X-Forwarded-For chain, which lets a caller claim any address and removes the rate ' +
        'limits rather than fixing them',
    )
  }

  const hops = Number(given)
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(`TRUST_PROXY must be a whole number of proxy hops, and was: ${String(env.TRUST_PROXY)}`)
  }

  return hops
}

/**
 * Whether the session cookie is marked `Secure`, which means "only ever send me over HTTPS".
 *
 * The bind address is the default answer and it is a guess, not a fact. It is right for the
 * two shapes this repository has: loopback with no TLS, where a Secure cookie would never come
 * back and nobody could log in, and a public bind, which the product brief says is a bind
 * behind HTTPS.
 *
 * It is wrong for the most ordinary deployment there is, which a security pass named: nginx or
 * Caddy terminating TLS on the same machine and proxying to `127.0.0.1:3000`, with `HOST` left
 * at its default. The board is then served over HTTPS while this process sees loopback, and
 * the guess sets no `Secure` - so the session cookie travels in clear text on any plain-HTTP
 * request to the same hostname, which a café wifi can provoke with one `<img>` tag.
 *
 * Hence `COOKIE_SECURE`, which overrides the guess and is the thing to set the day a proxy
 * appears. Not required, because requiring it would make stage one carry a fifth name for a
 * setting it cannot get wrong; loud at startup either way, because a deploy is precisely when
 * nobody re-reads this file.
 */
function cookieSecureFrom(env: NodeJS.ProcessEnv, host: string): boolean {
  const given = env.COOKIE_SECURE?.trim().toLowerCase()

  if (given !== undefined && given !== '') {
    if (given !== 'true' && given !== 'false') {
      throw new Error(`COOKIE_SECURE must be true or false, and was: ${String(env.COOKIE_SECURE)}`)
    }
    return given === 'true'
  }

  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1'
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
