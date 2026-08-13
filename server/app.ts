import express from 'express'
import type { ErrorRequestHandler, Express, RequestHandler } from 'express'
import type { Pool } from 'pg'
import type { Config } from './config.js'
import { readDay } from './day.js'
import { Refused, createEntry, parseEntryInput, removeEntry, updateEntry } from './write.js'
import { isSuggestable, suggest } from './suggestions.js'
import {
  currentVersion,
  replaceCredentials,
  secretEquals,
  versionForPassword,
  whyPasswordUnusable,
  whyPinUnusable,
} from './credentials.js'
import { SESSION_COOKIE, SESSION_LIFETIME_MS, issueSession, readSession, sessionCookieFrom, shouldRefresh } from './session.js'
import { isSalonDate, todayIn } from '../src/calendar/salon-date.js'

/** What the HTTP surface needs. The connection string and the bind address are startup's business. */
export type AppConfig = Pick<Config, 'salonTimeZone' | 'sessionSecret' | 'masterPassword' | 'cookieSecure'>

/**
 * The HTTP surface, separated from startup so it can be tested against a port rather than
 * by hand. Both blockers the first review found - an unvalidated date reaching Postgres
 * and a stack trace in the response - were invisible to the test suite because there was
 * nothing to point a request at.
 */
export function createApp(pool: Pool, config: AppConfig): Express {
  const app = express()
  const salonTimeZone = config.salonTimeZone

  // Nothing here needs to announce the framework and its presence in a header.
  app.disable('x-powered-by')

  // No CORS header is set anywhere, and that absence is load-bearing now that the board and
  // the API share an origin: it is what stops a page on another site reading a customer list.
  // A future "just add CORS so the app can call it" would undo it. ADR-0006.

  // A day of one salon's entries is a small object. The default 100kb would let somebody post
  // a megabyte of notes for no reason.
  const body = express.json({ limit: '16kb' })

  /**
   * Twenty attempts from one address in five minutes, which ADR-0004 asks for by name: a
   * single shared password is one guessable secret protecting everything.
   *
   * Twenty rather than five because the salon is one address as far as this server is
   * concerned - six people all typing a new password on the morning it changed is a burst of
   * legitimate attempts from what looks like one machine. The number is not what makes
   * guessing expensive; scrypt is. Measured on the machine this was written on, one derive
   * costs 22ms of CPU, so twenty attempts occupy a core for most of half a second.
   *
   * Behind a reverse proxy that Express is not told to trust, every request carries the
   * proxy's address, so the limit becomes one budget for everybody. That refuses logins rather
   * than allowing them, which is the right direction to fail, but it is still an outage:
   * stage two has to set `trust proxy` when the proxy arrives.
   */
  const attempts = attemptLimiter(20, 5 * 60 * 1000)

  /**
   * The salon password, exchanged for the signed session cookie. ADR-0004.
   *
   * Answers nothing but a status. A login response that said whether the password was close,
   * or how many attempts were left, would be telling somebody how to spend their next guess.
   */
  app.post('/api/login', attempts, body, async (request, response) => {
    const password = stringField(request.body, 'password')
    const version = password === null ? null : await versionForPassword(pool, password)

    if (version === null) {
      response.status(401).json({ error: 'Das Passwort stimmt nicht.' })
      return
    }

    setSession(response, config, version)
    response.status(204).end()
  })

  /**
   * The master password's one screen: a new salon password and a new PIN. ADR-0017.
   *
   * It hands back no session. Whoever resets the credentials then logs in with the password
   * they just set, like everybody else - the master password is the way back in, not a second
   * permanent login that never rotates.
   *
   * Changing the password increments the credential version, so every session in the salon
   * ends here. That is the point: the reason a password gets changed is that somebody left.
   */
  app.post('/api/credentials/reset', attempts, body, async (request, response) => {
    const master = stringField(request.body, 'master')
    if (master === null || !secretEquals(master, config.masterPassword)) {
      response.status(401).json({ error: 'Das Hauptpasswort stimmt nicht.' })
      return
    }

    const password = stringField(request.body, 'password') ?? ''
    const pin = stringField(request.body, 'pin') ?? ''
    const unusable = whyPasswordUnusable(password) ?? whyPinUnusable(pin)
    if (unusable !== null) {
      response.status(400).json({ error: unusable })
      return
    }

    await replaceCredentials(pool, password, pin)
    response.status(204).end()
  })

  /**
   * Everything below this line needs a valid session. ADR-0004: an unauthenticated request
   * returns no customer data - not a filtered day, not an empty shell that leaks names in an
   * error, nothing.
   *
   * Mounted on `/api` only. The built board underneath is HTML and JavaScript with no salon
   * data in it, and it has to load for anybody to reach the login screen at all.
   */
  app.use('/api', requireSession(pool, config))

  /**
   * The board, for one day. Without a date it answers today in the salon's timezone, so a
   * client never has to ask the device what day it is before it can ask for anything.
   *
   * ADR-0006: this is the only door to the data. No client talks to Postgres.
   */
  app.get('/api/day', async (request, response) => {
    const requested = request.query.date

    if (requested !== undefined && typeof requested !== 'string') {
      response.status(400).json({ error: 'date must be a single YYYY-MM-DD value' })
      return
    }

    const date = requested ?? todayIn(salonTimeZone, new Date())

    if (!isSalonDate(date)) {
      response.status(400).json({ error: 'date must be a real calendar date as YYYY-MM-DD' })
      return
    }

    response.json(await readDay(pool, date, salonTimeZone, new Date()))
  })

  /**
   * A new appointment or block.
   *
   * Answers only the new id. The client reloads the day rather than patching its own copy,
   * because ADR-0009 assigns colour from the whole day - a new appointment can change the
   * colour of boxes it never touched, and a client stitching the response into what it already
   * has would quietly disagree with every other screen.
   */
  app.post('/api/entries', body, async (request, response) => {
    const created = await createEntry(pool, parseEntryInput(request.body))
    response.status(201).json(created)
  })

  /** A change to an existing entry, refused if somebody else got there first. ADR-0003. */
  app.patch('/api/entries/:id', body, async (request, response) => {
    const input = parseEntryInput(request.body)
    const version = versionFrom((request.body as { version?: unknown }).version)
    response.json(await updateEntry(pool, request.params.id, version, input))
  })

  /**
   * What the modal offers while somebody types a customer or a treatment.
   *
   * A rolling year, and nothing at all for an empty query - an empty prefix would return the
   * salon's whole customer list in one request.
   */
  app.get('/api/suggestions', async (request, response) => {
    const field = request.query.field
    if (!isSuggestable(field)) {
      throw new Refused(400, 'invalid', 'Es kann nur nach Kundin oder Behandlung gesucht werden.')
    }

    const query = typeof request.query.q === 'string' ? request.query.q : ''
    response.json(await suggest(pool, field, query, todayIn(salonTimeZone, new Date())))
  })

  /** Removal, version-checked for the same reason a save is. */
  app.delete('/api/entries/:id', async (request, response) => {
    await removeEntry(pool, request.params.id, versionFrom(request.query.version))
    response.status(204).end()
  })

  // The built board, served from the same origin as the API. Mounted AFTER the route on
  // purpose: static first meant a file in `dist` at the path `api/day` would answer instead
  // of the API, which a review demonstrated.
  //
  // Precisely what that buys, because the first version of this comment overclaimed: the
  // route now wins on every path a client actually sends. Non-canonical spellings such as
  // `/api//day` and `/api/./day` do not match the Express route at all and still fall
  // through to here, where static normalises them. Nothing can write a file into `dist` over
  // HTTP, so that is a residue rather than a hole - but it is not "impossible".
  //
  // Relative to the working directory, like `migrations/`. Missing simply does not match,
  // which is what `npm run dev` relies on - Vite serves the front end then and proxies here.
  //
  // Note for anything added to `.env` from now on: a `VITE_`-prefixed variable is inlined
  // into the bundle at build time, and this line serves that bundle to everybody.
  app.use(express.static('dist'))

  // Without this, a client with a typo in the path gets Express's HTML "Cannot GET /..."
  // page and puts markup into response.json(). ADR-0006 promises a plain JSON interface
  // with a second consumer coming, and a contract that holds only on the happy path is
  // not a contract. Both review passes named it independently.
  app.use((_request, response) => {
    response.status(404).json({ error: 'not found' })
  })

  app.use(jsonErrors)

  return app
}

/**
 * Refuses every request that does not carry a session this server issued and still honours.
 *
 * The credential version is read from the database on each request rather than cached, which
 * is what makes "changing the password logs everybody out" true within one request instead of
 * within one restart. It is a single-row primary-key lookup next to a query that reads a whole
 * day; if it ever shows up in a profile, the cache it wants has to survive two instances.
 */
function requireSession(pool: Pool, config: AppConfig): RequestHandler {
  return async (request, response, next) => {
    const cookie = sessionCookieFrom(request.headers.cookie)
    const session = cookie === null ? null : readSession(config.sessionSecret, cookie, Date.now())

    if (session === null || session.version !== (await currentVersion(pool))) {
      // One answer for no cookie, a forged cookie, an expired cookie and a cookie from before
      // the password changed. The client's move is the same in every case, and naming which it
      // was would tell somebody probing whether their forgery was well formed.
      response.status(401).json({ error: 'Bitte anmelden.' })
      return
    }

    // Use keeps the session alive, so nobody is asked for the password mid-shift.
    if (shouldRefresh(session, Date.now())) setSession(response, config, session.version)

    next()
  }
}

/** The one place a session cookie is written, so its attributes cannot drift apart. */
function setSession(response: express.Response, config: AppConfig, version: number): void {
  response.cookie(SESSION_COOKIE, issueSession(config.sessionSecret, version, Date.now()), {
    httpOnly: true,
    // Lax rather than Strict. Strict would drop the cookie on the first click of a link to the
    // board sent in a chat - the board would show the login screen, and work on a refresh,
    // which reads as broken. Lax still refuses to send it on a cross-site POST, which is the
    // request that would matter.
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: SESSION_LIFETIME_MS,
    path: '/',
  })
}

/**
 * A fixed number of requests per address per window, for the two doors that take a secret.
 *
 * In memory and per process on purpose: it is a speed bump on guessing, not an account
 * lockout, and it resets on restart. Anything more - shared state, a durable counter - is a
 * second system to run for a salon with one password.
 */
function attemptLimiter(limit: number, windowMs: number): RequestHandler {
  const seen = new Map<string, { count: number; until: number }>()

  return (request, response, next) => {
    const now = Date.now()
    // Swept on every attempt rather than on a timer. The map only ever holds addresses that
    // tried to log in inside the window, so this is a handful of entries and no timer to stop.
    for (const [address, entry] of seen) {
      if (entry.until <= now) seen.delete(address)
    }

    const address = request.ip ?? 'unknown'
    const entry = seen.get(address) ?? { count: 0, until: now + windowMs }
    entry.count += 1
    seen.set(address, entry)

    if (entry.count > limit) {
      response.status(429).json({ error: 'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.' })
      return
    }

    next()
  }
}

/** One string field out of a parsed JSON body, or null. A missing field is not an empty one. */
function stringField(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : null
}

/** A version from a request body or query string, or a refusal. Never a guess. */
function versionFrom(value: unknown): number {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Refused(400, 'invalid', 'Es fehlt die Version des Eintrags.')
  }
  return version
}

/**
 * Express's default handler writes `err.stack` into the response body unless NODE_ENV is
 * `production`, and `npm start` does not set it - so on the VPS a database failure would
 * hand the caller absolute server paths, the driver in use and raw Postgres error text.
 *
 * This answers a bare JSON error instead and puts the detail where it belongs, in the
 * server log. It does not depend on NODE_ENV, because a safety property that is switched
 * on by an environment variable somebody has to remember is not a safety property.
 */
const jsonErrors: ErrorRequestHandler = (error, _request, response, _next) => {
  // A refusal is the rules working, not a fault. It carries a sentence written for the person
  // reading the screen, and it is not logged as a failure - a log full of "that slot is taken"
  // is a log nobody reads when something is actually wrong.
  if (error instanceof Refused) {
    response.status(error.status).json({ error: error.message, code: error.code })
    return
  }

  // Malformed or oversized JSON never reaches a handler, so express reports it here. Without
  // this it would be a 500, telling the caller the server broke when in fact they did.
  const parsed = error as { type?: string }
  if (parsed.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Die Anfrage war kein gültiges JSON.' })
    return
  }
  if (parsed.type === 'entity.too.large') {
    response.status(413).json({ error: 'Die Anfrage ist zu groß.' })
    return
  }

  console.error('request failed', loggable(error))
  response.status(500).json({ error: 'internal error' })
}

/**
 * The parts of an error worth keeping, and none of the row that caused it.
 *
 * Logging the whole error object would print a Postgres `detail`, which for a constraint
 * violation contains every column of the failing row - customer name, treatment, and
 * `notes`, which is where a salon writes "allergic to ammonia". That is health data, and
 * a log file is not where anybody decided to keep it. No write path can trigger it yet;
 * this exists so the write path cannot introduce it silently either.
 *
 * `message`, `code` and `constraint` name the rule that was broken, which is what
 * debugging actually needs, and the stack says where. None of them carry column values.
 */
function loggable(error: unknown): unknown {
  if (!(error instanceof Error)) return { error: String(error) }

  const database = error as Error & { code?: string; constraint?: string }
  return {
    message: error.message,
    code: database.code,
    constraint: database.constraint,
    stack: error.stack,
  }
}
