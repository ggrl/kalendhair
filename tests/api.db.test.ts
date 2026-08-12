import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { addAppointment, addEmployee, empty, testPool } from './db-helper.js'

// The route had no test at all, and both blockers the first review found lived here: a
// date the validator accepted and Postgres refused, answered with a stack trace.

const TZ = 'Europe/Berlin'

let pool: Pool
let server: Server
let base: string

beforeAll(async () => {
  pool = await testPool()
  await empty(pool)
  const marco = await addEmployee(pool, 'Marco', 1)
  await addAppointment(pool, marco, '2026-08-13', '10:00', '11:00', 'Anna Schmidt', 'Colour')

  server = createApp(pool, TZ).listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
  await pool.end()
})

describe('GET /api/day', () => {
  it('answers the requested day', async () => {
    const response = await fetch(`${base}/api/day?date=2026-08-13`)
    expect(response.status).toBe(200)

    const day = await response.json()
    expect(day.date).toBe('2026-08-13')
    expect(day.entries).toHaveLength(1)
    expect(day.entries[0].startsAt).toBe('10:00')
  })

  it('answers today when no date is given', async () => {
    const response = await fetch(`${base}/api/day`)
    expect(response.status).toBe(200)

    const day = await response.json()
    expect(day.date).toBe(day.today)
  })

  it('refuses year zero rather than letting Postgres refuse it', async () => {
    // JavaScript has a year zero, Postgres does not. This used to reach the database and
    // come back as a 500 carrying err.stack and absolute server paths.
    for (const date of ['0000-01-01', '0000-02-29']) {
      const response = await fetch(`${base}/api/day?date=${date}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'date must be a real calendar date as YYYY-MM-DD' })
    }
  })

  it('refuses a date that is not one', async () => {
    for (const date of ['2026-02-30', '2026-13-01', '2026-8-13', 'tomorrow', '']) {
      const response = await fetch(`${base}/api/day?date=${encodeURIComponent(date)}`)
      expect(response.status).toBe(400)
    }
  })

  it('refuses a repeated date parameter instead of picking one', async () => {
    const response = await fetch(`${base}/api/day?date=2026-08-13&date=2026-08-14`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'date must be a single YYYY-MM-DD value' })
  })
})

describe('when the database fails', () => {
  it('answers JSON without a stack trace', async () => {
    // Express writes err.stack into the body unless NODE_ENV is production, and `npm start`
    // does not set it - so on the VPS this was the default. The handler must not depend on
    // an environment variable somebody has to remember.
    //
    // A stub rather than a real outage: the point is what the client receives, and there is
    // no way to make a healthy pool fail on demand. Cast because only `query` is reached.
    const broken = {
      query: () => Promise.reject(new Error('relation "appointment" does not exist')),
    } as unknown as Pool

    const failing = createApp(broken, TZ).listen(0)
    await new Promise<void>((resolve) => failing.once('listening', resolve))
    const address = failing.address()
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address')

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/day?date=2026-08-13`)
      expect(response.status).toBe(500)
      expect(response.headers.get('content-type')).toMatch(/application\/json/)

      const body = await response.text()
      expect(JSON.parse(body)).toEqual({ error: 'internal error' })
      expect(body).not.toMatch(/does not exist/)
      expect(body).not.toMatch(/node_modules|\/Users\/|at async/)
    } finally {
      await new Promise<void>((resolve, reject) => {
        failing.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    }
  })
})
