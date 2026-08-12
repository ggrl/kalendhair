import express from 'express'
import type { ErrorRequestHandler, Express } from 'express'
import type { Pool } from 'pg'
import { readDay } from './day.js'
import { isSalonDate, todayIn } from '../src/calendar/salon-date.js'

/**
 * The HTTP surface, separated from startup so it can be tested against a port rather than
 * by hand. Both blockers the first review found - an unvalidated date reaching Postgres
 * and a stack trace in the response - were invisible to the test suite because there was
 * nothing to point a request at.
 */
export function createApp(pool: Pool, salonTimeZone: string): Express {
  const app = express()

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

  app.use(jsonErrors)

  return app
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
  console.error('request failed', error)
  response.status(500).json({ error: 'internal error' })
}
