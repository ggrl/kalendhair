import express from 'express'
import type { ErrorRequestHandler, Express, RequestHandler } from 'express'
import type { Pool } from 'pg'
import type { Config } from './config.js'
import { readDay } from './day.js'
import { Refused, createEntry, parseEntryInput, removeEntry, updateEntry } from './write.js'
import { isSuggestable, suggest } from './suggestions.js'
import {
  currentVersion,
  pinMatches,
  replaceCredentials,
  replacePassword,
  replacePin,
  secretMatches,
  versionForPassword,
  whyPasswordUnusable,
  whyPinUnusable,
} from './credentials.js'
import { addStaff, moveStaff, readStaff, removeStaff, updateStaff } from './staff.js'
import { readWeek, writeWeek } from './hours.js'
import { SESSION_COOKIE, SESSION_LIFETIME_MS, issueSession, readSession, sessionCookieFrom, shouldRefresh } from './session.js'
import { isSalonDate, todayIn } from '../src/calendar/salon-date.js'
import { PIN_HEADER } from '../src/calendar/types.js'

/** What the HTTP surface needs. The connection string and the bind address are startup's business. */
export interface AppConfig extends Pick<Config, 'salonTimeZone' | 'sessionSecret' | 'cookieSecure' | 'trustProxy'> {
  /**
   * The master password as a scrypt hash, made once at startup rather than compared as plain
   * text.
   *
   * Not for storage - it never leaves the process - but for cost. A security pass measured the
   * plain comparison at 0.875 microseconds against 24ms for a salon password guess, on the
   * endpoint that grants strictly more power: reset both credentials, log in, read the book,
   * and lock the salon out of its own door. Both doors now cost the same to knock on.
   */
  masterPasswordHash: string
}

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

  /**
   * Who the caller is, when something sits in front of this server.
   *
   * Set only when configured, because Express's own default is the safe one and this is the
   * setting that decides whether the three attempt counters below are per-visitor or shared.
   * Both directions are a real failure and they are opposite: unset behind a proxy makes every
   * request look like the proxy, so one stranger can spend everybody's budget; set with no
   * proxy makes `request.ip` whatever the caller writes in a header. The environment is the
   * only thing that knows which shape this deployment is - see `trustProxyFrom` in config.ts.
   */
  if (config.trustProxy > 0) {
    app.set('trust proxy', config.trustProxy)
  }

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
   * proxy's address, so the limit becomes one budget for everybody - and a stranger can then
   * hold the salon's door shut at four requests a minute. Stage two has to set `trust proxy`
   * when the proxy arrives, and to the specific hop: `trust proxy: true` makes
   * `X-Forwarded-For` whatever the caller says it is, which removes this entirely.
   *
   * Two limiters and not one. Sharing the budget meant the door built for a forgotten password
   * was shut by somebody forgetting their password: twenty wrong guesses, then the correct
   * master password refused for five minutes. A review pass demonstrated it.
   */
  const loginAttempts = attemptLimiter(20, 5 * 60 * 1000)
  const resetAttempts = attemptLimiter(20, 5 * 60 * 1000)

  /**
   * The salon password, exchanged for the signed session cookie. ADR-0004.
   *
   * Answers nothing but a status. A login response that said whether the password was close,
   * or how many attempts were left, would be telling somebody how to spend their next guess.
   */
  app.post('/api/login', loginAttempts, body, async (request, response) => {
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
  app.post('/api/credentials/reset', resetAttempts, body, async (request, response) => {
    const password = stringField(request.body, 'password') ?? ''
    const pin = stringField(request.body, 'pin') ?? ''

    // What was typed is checked before who is asking, so that a 400 never confirms a correct
    // master password. The other order let somebody test a guess without changing anything:
    // 401 meant wrong, 400 meant right and the new password was merely too short.
    const unusable = whyPasswordUnusable(password) ?? whyPinUnusable(pin)
    if (unusable !== null) {
      response.status(400).json({ error: unusable })
      return
    }

    const master = stringField(request.body, 'master')
    if (master === null || !(await secretMatches(master, config.masterPasswordHash))) {
      response.status(401).json({ error: 'Das Hauptpasswort stimmt nicht.' })
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
   * And everything under `/api/settings` needs the PIN as well. ADR-0017: it sits behind a valid
   * session, so it is not the boundary between the salon and the internet - it is the boundary
   * between using the board and changing it.
   *
   * In a header rather than a body, so that one guard covers the reads too and no PIN is ever
   * spelled into a URL, where it would land in every access log the request passes through. A
   * custom header has a second effect worth naming: a cross-site form post cannot set one, so
   * these routes are out of reach of the request shape SameSite=Lax still allows.
   *
   * The PIN is checked on every settings request, not exchanged for anything. The owner chose to
   * be asked each time the screen is opened, and a screen that holds no ticket cannot leave one
   * lying around on the front desk machine.
   */
  app.use('/api/settings', requirePin(pool))

  /**
   * Nothing but the PIN check, for opening the screen.
   *
   * The screen needs an answer before it draws anything, and "fetch the staff list and see if it
   * fails" would put a refusal in the place where a prompt belongs.
   */
  app.post('/api/settings/unlock', (_request, response) => {
    response.status(204).end()
  })

  /** The staff list the salon manages: everybody, including the people not on the board. */
  app.get('/api/settings/staff', async (_request, response) => {
    response.json(await readStaff(pool))
  })

  app.post('/api/settings/staff', body, async (request, response) => {
    response.status(201).json(await addStaff(pool, stringField(request.body, 'name') ?? ''))
  })

  /** A rename, or a change of whether somebody is on the board at all. ADR-0012 decides the rest. */
  app.patch('/api/settings/staff/:id', body, async (request, response) => {
    const name = stringField(request.body, 'name')
    const active = booleanField(request.body, 'active')

    if (name === null && active === null) {
      throw new Refused(400, 'invalid', 'Es wurde nichts geändert.')
    }

    await updateStaff(pool, request.params.id, {
      name: name ?? undefined,
      active: active ?? undefined,
    })
    response.status(204).end()
  })

  /** One step up or down the column order. ADR-0018: buttons, not a second drag implementation. */
  app.post('/api/settings/staff/:id/move', body, async (request, response) => {
    const direction = stringField(request.body, 'direction')
    if (direction !== 'up' && direction !== 'down') {
      throw new Refused(400, 'invalid', 'Es geht nur nach oben oder nach unten.')
    }

    await moveStaff(pool, request.params.id, direction)
    response.status(204).end()
  })

  /** ADR-0018's narrow exception to ADR-0002, refused by the foreign key for anybody with history. */
  app.delete('/api/settings/staff/:id', async (request, response) => {
    await removeStaff(pool, request.params.id)
    response.status(204).end()
  })

  /**
   * A new salon password, which ends every session in the salon including this one. ADR-0017.
   *
   * Answered with 204 and nothing else. The client's own next request is refused, which is how
   * it finds out - the same path as any other expired session, rather than a second mechanism
   * that only this screen knows about.
   */
  app.post('/api/settings/password', body, async (request, response) => {
    const password = stringField(request.body, 'password') ?? ''
    const unusable = whyPasswordUnusable(password)
    if (unusable !== null) throw new Refused(400, 'invalid', unusable)

    await replacePassword(pool, password)
    response.status(204).end()
  })

  /**
   * The salon's core hours, all seven days of them. ADR-0018.
   *
   * Behind the PIN like everything else here, and a `PUT` rather than a `PATCH` because the unit
   * the salon edits is the week: one screen, one button, one transaction, and no way to leave
   * Tuesday changed and Saturday refused.
   */
  app.get('/api/settings/hours', async (_request, response) => {
    response.json(await readWeek(pool))
  })

  app.put('/api/settings/hours', body, async (request, response) => {
    await writeWeek(pool, (request.body as { week?: unknown })?.week)
    response.status(204).end()
  })

  /** A new PIN, which ends nothing: no session was ever bought with one. */
  app.post('/api/settings/pin', body, async (request, response) => {
    const pin = stringField(request.body, 'pin') ?? ''
    const unusable = whyPinUnusable(pin)
    if (unusable !== null) throw new Refused(400, 'invalid', unusable)

    await replacePin(pool, pin)
    response.status(204).end()
  })

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
  // Precisely what that buys, because the first version of this comment overclaimed, and the
  // second one still did. Measured under express 5.2.1: `/api/./settings/staff` and
  // `/api/settings/../settings/staff` **do** match the route, and both guards run on them - the
  // claim that they "do not match at all" was wrong, in the safe direction. `/api//day` really
  // does miss the route and falls through to here, where static normalises it. Nothing can write
  // a file into `dist` over HTTP, so that is a residue rather than a hole - but it is not
  // "impossible", and a wrong "cannot happen" is what closes a future investigation early.
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

/**
 * Refuses every settings request that does not carry the PIN.
 *
 * 403 and not 401: the difference matters to the client, because a session that has ended sends
 * somebody to the login screen and a wrong PIN sends them back to the PIN prompt. Answering both
 * with 401 would have the settings screen log people out for a mistyped digit.
 */
function requirePin(pool: Pool): RequestHandler {
  /**
   * Ten wrong PINs per address per five minutes, and **only wrong ones count**.
   *
   * The settings screen makes a handful of requests every time it is opened, all carrying the
   * PIN it was given, so counting every request would spend the budget on somebody using the
   * screen correctly. A right PIN costs nothing; a wrong one costs one.
   *
   * ADR-0017 accepted unlimited guessing, on the stated grounds that reaching this needs a valid
   * session "so it is a colleague". ADR-0021 put the board on phones that leave the building and
   * that premise stopped holding, which is what this answers. **It is a speed bump and the owner
   * chose it as one**: ten tries per five minutes still walks the whole four-digit space in about
   * three and a half days, and the thing actually guarding the salon's data is the login.
   *
   * Checked before the hash comparison, so a blocked address costs no scrypt derive - which also
   * bounds, without closing, the thread-pool exhaustion ADR-0018 records as known and accepted.
   */
  const wrong = attemptCounter(5 * 60 * 1000)
  const limit = 10

  return async (request, response, next) => {
    const address = request.ip ?? 'unknown'
    const pin = request.header(PIN_HEADER)

    if (pin === undefined) {
      // Refused, and it costs nothing. **A missing header is not a guess** - it is what every
      // request from something that was never given the PIN looks like, and counting it spent the
      // budget on innocent traffic: the test that walks every settings route without the header
      // burned eight of ten tries in one go. An attack always sends a PIN.
      //
      // Answered before the limit is consulted, so a headerless request says the same thing
      // whether or not the address is blocked. Checking the limit first told a stranger sharing an
      // address that somebody else was failing PIN entry, for nothing.
      response.status(403).json({ error: 'Die PIN stimmt nicht.' })
      return
    }

    // **Reserved before the derive, and given back if the PIN was right.**
    //
    // Counting after `pinMatches` resolved was a check-then-act race one scrypt derive wide: every
    // request that arrived inside that window read the counter as it had been before any of them
    // landed. A security pass measured a burst of 500 concurrent wrong PINs performing 131 derives
    // against a limit of ten, with the multiplier being the attacker's socket count rather than
    // any constant - which put the whole four-digit space back within about a minute, exactly
    // where ADR-0017 measured it with no limiter at all.
    //
    // Reserving first bounds the derives at the limit no matter how many requests arrive at once.
    // The refund is what keeps "only a wrong PIN costs anything" true: the settings screen makes
    // several requests each time it opens, all carrying the PIN it was given.
    const attempts = wrong.add(address)

    if (attempts > limit) {
      response.status(429).json({ error: 'Zu viele falsche PIN-Eingaben. Bitte in einigen Minuten erneut versuchen.' })
      return
    }

    if (!(await pinMatches(pool, pin))) {
      response.status(403).json({ error: 'Die PIN stimmt nicht.' })
      return
    }

    wrong.refund(address)
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
  const counter = attemptCounter(windowMs)

  return (request, response, next) => {
    if (counter.add(request.ip ?? 'unknown') > limit) {
      response.status(429).json({ error: 'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.' })
      return
    }

    next()
  }
}

/**
 * The counting behind the limiters, kept in one place because two copies of a sweep is one copy
 * too many - this one carries a measured fix and a subtlety that would not survive being retyped.
 *
 * `add` records an attempt and answers how many are in the window. `count` answers without
 * recording, which is what a guard needs when only *failures* should cost anything.
 */
function attemptCounter(windowMs: number): {
  add: (address: string) => number
  refund: (address: string) => void
  count: (address: string) => number
} {
  const seen = new Map<string, { count: number; until: number }>()
  let sweptAt = 0

  /**
   * The window is checked on read and not left to the sweep. With the sweep throttled, an address
   * can be read back before its entry is collected, and taking that stale count would keep
   * somebody locked out for as long as they kept trying.
   */
  function live(address: string, now: number): { count: number; until: number } | undefined {
    const held = seen.get(address)
    return held === undefined || held.until <= now ? undefined : held
  }

  return {
    add(address) {
      const now = Date.now()

    // Swept on a request rather than on a timer, so there is nothing to stop at shutdown - but
    // at most once a second. Sweeping on every attempt was measured by a security pass at 21ms
    // of blocked event loop with 300,000 addresses in the map, which one machine with a routed
    // IPv6 range can produce in five minutes. Once a second, that cost is paid once a second.
      if (now - sweptAt >= 1000) {
        sweptAt = now
        for (const [other, entry] of seen) {
          if (entry.until <= now) seen.delete(other)
        }
      }

      const entry = live(address, now) ?? { count: 0, until: now + windowMs }
      entry.count += 1
      seen.set(address, entry)
      return entry.count
    },

    /**
     * Gives one attempt back, for a guard that has to reserve before it knows the answer.
     *
     * Never below zero, and it does not create an entry: refunding an address with no live window
     * is a no-op rather than a way to mint credit.
     */
    refund(address) {
      const entry = live(address, Date.now())
      if (entry !== undefined && entry.count > 0) entry.count -= 1
    },

    count(address) {
      return live(address, Date.now())?.count ?? 0
    },
  }
}

/** One string field out of a parsed JSON body, or null. A missing field is not an empty one. */
function stringField(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : null
}

/** The same for a flag, where null means "not mentioned" and is different from false. */
function booleanField(body: unknown, name: string): boolean | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[name]
  return typeof value === 'boolean' ? value : null
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
