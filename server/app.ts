import express from 'express'
import type { ErrorRequestHandler, Express } from 'express'
import type { Pool } from 'pg'
import { readDay } from './day.js'
import { Refused, createEntry, parseEntryInput, removeEntry, updateEntry } from './write.js'
import { isSalonDate, todayIn } from '../src/calendar/salon-date.js'

/**
 * The HTTP surface, separated from startup so it can be tested against a port rather than
 * by hand. Both blockers the first review found - an unvalidated date reaching Postgres
 * and a stack trace in the response - were invisible to the test suite because there was
 * nothing to point a request at.
 */
export function createApp(pool: Pool, salonTimeZone: string): Express {
  const app = express()

  // Nothing here needs to announce the framework and its presence in a header.
  app.disable('x-powered-by')

  // No CORS header is set anywhere, and that absence is load-bearing now that the board and
  // the API share an origin: it is what stops a page on another site reading a customer list.
  // A future "just add CORS so the app can call it" would undo it. ADR-0006.

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

  // A day of one salon's entries is a small object. The default 100kb would let somebody post
  // a megabyte of notes for no reason.
  const body = express.json({ limit: '16kb' })

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

/** A version from a request body or query string, or a refusal. Never a guess. */
function versionFrom(value: unknown): number {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Refused(400, 'Es fehlt die Version des Eintrags.')
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
    response.status(error.status).json({ error: error.message })
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
