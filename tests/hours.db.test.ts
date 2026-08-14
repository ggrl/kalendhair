import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import type { CoreHours, CoreHoursDay } from '../src/calendar/types.js'
import { PIN_HEADER } from '../src/calendar/types.js'
import { TEST_CONFIG, TEST_PIN, ensureCredentials, sessionHeader, testPool } from './db-helper.js'

// ADR-0018's core hours, over HTTP against a real Postgres. The hours live in the database now,
// so this is the only place the answer can honestly be asserted: a stubbed API would only prove
// what the fixture was told to say.

let pool: Pool
let server: Server
let base: string
let cookie: string

/**
 * What `migrations/005_core_hours.sql` seeds, which is exactly what `CORE_HOURS` held in
 * `src/calendar/opening.ts` on the day it was deleted.
 *
 * Written out here rather than imported, because the constant it has to match no longer exists -
 * and that is the point. If the migration and this table ever disagree, every board in the salon
 * changes colour and nothing else notices.
 */
const SEEDED: CoreHoursDay[] = [
  { weekday: 1, hours: null },
  { weekday: 2, hours: { from: '09:00', to: '18:00' } },
  { weekday: 3, hours: { from: '09:00', to: '18:00' } },
  { weekday: 4, hours: { from: '09:00', to: '18:00' } },
  { weekday: 5, hours: { from: '09:00', to: '18:00' } },
  { weekday: 6, hours: { from: '08:00', to: '13:30' } },
  { weekday: 7, hours: null },
]

async function settings(path: string, init: RequestInit = {}, pin = TEST_PIN): Promise<Response> {
  return fetch(`${base}/api/settings${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie,
      [PIN_HEADER]: pin,
      ...init.headers,
    },
  })
}

async function week(): Promise<CoreHoursDay[]> {
  return (await (await settings('/hours')).json()) as CoreHoursDay[]
}

async function save(sent: unknown): Promise<Response> {
  return settings('/hours', { method: 'PUT', body: JSON.stringify({ week: sent }) })
}

/** What the board would shade this date around. */
async function shadingOn(date: string): Promise<CoreHours | null> {
  const day = (await (await fetch(`${base}/api/day?date=${date}`, { headers: { cookie } })).json()) as {
    coreHours: CoreHours | null
  }
  return day.coreHours
}

/**
 * Back to the seed.
 *
 * The database tests share one database and run in file order, so a file that left Saturday at
 * 08:00-12:00 would change what the next one sees `/api/day` say. `empty()` deliberately does not
 * touch this table - it holds no test data, it holds the salon's configuration.
 */
async function reseed(): Promise<void> {
  for (const day of SEEDED) {
    // An upsert rather than an `UPDATE`, so this also puts back a row a test deleted on purpose.
    await pool.query(
      `INSERT INTO core_hours (weekday, opens_at, closes_at) VALUES ($1, $2, $3)
       ON CONFLICT (weekday) DO UPDATE SET opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at`,
      [day.weekday, day.hours?.from ?? null, day.hours?.to ?? null],
    )
  }
}

beforeAll(async () => {
  pool = await testPool()
  await ensureCredentials(pool)

  server = createApp(pool, TEST_CONFIG).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await reseed()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await pool.end()
})

beforeEach(async () => {
  await reseed()
  cookie = await sessionHeader(pool)
})

describe('what the migration seeded', () => {
  it('is exactly the week the constant held, so no board changed colour', async () => {
    // The one assertion that makes this migration safe to run against the salon's database. A
    // seed that disagreed with the deleted constant would re-shade every day in the calendar and
    // look like nothing at all had happened.
    expect(await week()).toEqual(SEEDED)
  })

  it('comes back Monday first, however the rows were written', async () => {
    expect((await week()).map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('what the board is told to shade', () => {
  it('sends the weekday hours with the day', async () => {
    // 2026-08-13 is a Thursday and 2026-08-15 a Saturday.
    expect(await shadingOn('2026-08-13')).toEqual({ from: '09:00', to: '18:00' })
    expect(await shadingOn('2026-08-15')).toEqual({ from: '08:00', to: '13:30' })
  })

  it('sends null on the days the salon does not work', async () => {
    expect(await shadingOn('2026-08-16')).toBeNull()
    expect(await shadingOn('2026-08-10')).toBeNull()
  })

  it('sends null on a Hessen public holiday that falls on a working day', async () => {
    // ADR-0016's list, applied on the server now rather than in the browser. 25 December 2026 is
    // a Friday, so nothing about the weekday explains this - the row for Friday says 09:00-18:00
    // and this still has to be null.
    expect(await shadingOn('2026-12-25')).toBeNull()

    // And Heiligabend is not a public holiday in Hessen, whatever the salon chooses to do about
    // it, so the day before is an ordinary Thursday.
    expect(await shadingOn('2026-12-24')).toEqual({ from: '09:00', to: '18:00' })
  })

  it('follows a change, which is the whole point of moving them here', async () => {
    await save([
      ...SEEDED.slice(0, 5),
      { weekday: 6, hours: { from: '08:00', to: '12:00' } },
      { weekday: 7, hours: null },
    ])

    expect(await shadingOn('2026-08-15')).toEqual({ from: '08:00', to: '12:00' })
    // And every other Saturday there has ever been, because the hours have no history: ADR-0018,
    // accepted by the owner. This one is nine years earlier.
    expect(await shadingOn('2017-08-19')).toEqual({ from: '08:00', to: '12:00' })
  })
})

describe('saving a week', () => {
  it('writes all seven days', async () => {
    const changed: CoreHoursDay[] = [
      { weekday: 1, hours: { from: '10:00', to: '16:00' } },
      { weekday: 2, hours: { from: '10:00', to: '16:00' } },
      { weekday: 3, hours: null },
      { weekday: 4, hours: { from: '06:00', to: '20:00' } },
      { weekday: 5, hours: { from: '09:15', to: '17:45' } },
      { weekday: 6, hours: { from: '08:00', to: '13:30' } },
      { weekday: 7, hours: null },
    ]

    const response = await save(changed)
    expect(response.status).toBe(204)
    expect(await week()).toEqual(changed)
  })

  it('accepts the full bookable window at both ends', async () => {
    // 06:00 to 20:00 is the widest a day can be, and it leaves no band at all - the board draws
    // nothing rather than a zero-height element.
    await save([...SEEDED.slice(0, 3), { weekday: 4, hours: { from: '06:00', to: '20:00' } }, ...SEEDED.slice(4)])
    expect(await shadingOn('2026-08-13')).toEqual({ from: '06:00', to: '20:00' })
  })
})

describe('a week the board could not draw', () => {
  /** Everything the seed says, with one weekday replaced. */
  function weekWith(weekday: number, hours: CoreHoursDay['hours']): CoreHoursDay[] {
    return SEEDED.map((day) => (day.weekday === weekday ? { weekday, hours } : day))
  }

  async function refused(sent: unknown): Promise<{ status: number; error: string }> {
    const response = await save(sent)
    const body = (await response.json()) as { error: string }
    return { status: response.status, error: body.error }
  }

  it('refuses an end before the beginning, and names the day', async () => {
    const { status, error } = await refused(weekWith(6, { from: '18:00', to: '09:00' }))
    expect(status).toBe(400)
    expect(error).toBe('Samstag: Das Ende muss nach dem Beginn liegen.')
  })

  it('refuses an end equal to the beginning rather than reading it as closed', async () => {
    // There is a tick that says closed. Silently turning 09:00 to 09:00 into a shut day would
    // throw away what somebody typed with nothing on screen saying so.
    const { status, error } = await refused(weekWith(2, { from: '09:00', to: '09:00' }))
    expect(status).toBe(400)
    expect(error).toBe('Dienstag: Das Ende muss nach dem Beginn liegen.')
  })

  it('refuses a time that is not on a quarter hour', async () => {
    // The board is a grid of 15-minute rows: 09:07 cannot be drawn where it says it is, and
    // rounding it would leave the settings screen and the board disagreeing about the same number.
    const { status, error } = await refused(weekWith(3, { from: '09:07', to: '18:00' }))
    expect(status).toBe(400)
    expect(error).toContain('Mittwoch')
    expect(error).toContain('Viertelstunde')
  })

  it('refuses hours outside the bookable window', async () => {
    const { error } = await refused(weekWith(4, { from: '05:00', to: '18:00' }))
    expect(error).toBe('Donnerstag: Kernzeiten sind nur zwischen 06:00 und 20:00 möglich.')

    const late = await refused(weekWith(4, { from: '09:00', to: '21:00' }))
    expect(late.error).toContain('Donnerstag')
  })

  it('refuses a nonsense time', async () => {
    expect((await refused(weekWith(5, { from: 'neun', to: '18:00' }))).status).toBe(400)
    expect((await refused(weekWith(5, { from: '9:00', to: '18:00' }))).status).toBe(400)
  })

  it('refuses a week that is not seven days', async () => {
    expect((await refused(SEEDED.slice(0, 6))).error).toBe('Es müssen alle sieben Wochentage geschickt werden.')
    expect((await refused([])).status).toBe(400)
    expect((await refused('Dienstag')).status).toBe(400)
    expect((await refused(undefined)).status).toBe(400)
  })

  it('refuses a week with the same day twice', async () => {
    // Six real days and Tuesday sent again is seven entries, so a length check alone would let
    // this through and leave whichever day was missing at whatever it already was.
    const twice = [...SEEDED.slice(0, 6), { weekday: 2, hours: null }]
    expect((await refused(twice)).error).toBe('Es müssen alle sieben Wochentage geschickt werden.')
  })

  it('refuses a weekday that is not a weekday', async () => {
    expect((await refused(weekWith(6, null).concat({ weekday: 8, hours: null }))).status).toBe(400)
  })

  it('changes nothing at all when it refuses', async () => {
    // A refusal on Saturday must not leave Tuesday changed, or the screen is showing a week that
    // was never saved.
    //
    // **What makes this pass is that the whole week is validated before the first `UPDATE`, not
    // the transaction around them** - so this asserts the outcome and proves only the first half
    // of the mechanism. The transaction covers the gap between the two: a row the API let through
    // and a database CHECK then refused, which is a case nothing here can currently produce.
    const half = weekWith(2, { from: '11:00', to: '12:00' })
    const bad = half.map((day) => (day.weekday === 6 ? { weekday: 6, hours: { from: '18:00', to: '09:00' } } : day))

    expect((await save(bad)).status).toBe(400)
    expect(await week()).toEqual(SEEDED)
  })
})

describe('a weekday with no row at all', () => {
  it('does not answer 204 for a write that changed nothing', async () => {
    // Nothing in the application can produce this - the seven rows come from the migration and no
    // code deletes them - but the answer to a write that silently did nothing must not be "saved".
    // A review pass found the `rowCount` going unread.
    await pool.query('DELETE FROM core_hours WHERE weekday = 6')

    const response = await save(SEEDED)
    expect(response.status).toBe(500)

    // And the transaction rolled back, so the days before Saturday in the loop are untouched.
    await pool.query("UPDATE core_hours SET opens_at = '11:11', closes_at = '12:12' WHERE weekday = 1")
    expect((await save(SEEDED)).status).toBe(500)
    const monday = (await pool.query<{ from: string | null }>(
      `SELECT to_char(opens_at, 'HH24:MI') AS "from" FROM core_hours WHERE weekday = 1`,
    )).rows[0]
    expect(monday.from).toBe('11:11')
  })
})

describe('the database refuses what the API would have refused', () => {
  it('will not store an end before the beginning', async () => {
    // The API says this in German first. This is what makes it true rather than usually true -
    // the same division of labour ADR-0001 sets up for the overlap rule.
    await expect(
      pool.query("UPDATE core_hours SET opens_at = '18:00', closes_at = '09:00' WHERE weekday = 6"),
    ).rejects.toThrow(/core_hours_positive_span/)
  })

  it('will not store a day that is half open', async () => {
    await expect(
      pool.query("UPDATE core_hours SET opens_at = '09:00', closes_at = NULL WHERE weekday = 2"),
    ).rejects.toThrow(/core_hours_both_or_neither/)
  })

  it('will not store an eighth weekday', async () => {
    await expect(pool.query('INSERT INTO core_hours (weekday) VALUES (8)')).rejects.toThrow()
  })
})

describe('who may change the hours', () => {
  it('refuses a wrong PIN with 403, and reads too', async () => {
    expect((await settings('/hours', {}, '9999')).status).toBe(403)
    expect((await settings('/hours', { method: 'PUT', body: JSON.stringify({ week: SEEDED }) }, '9999')).status).toBe(403)
  })

  it('refuses an ended session with 401, whatever the PIN says', async () => {
    // Checked in that order deliberately: somebody holding the PIN and no session learns nothing
    // about whether their four digits were right. ADR-0018.
    const response = await fetch(`${base}/api/settings/hours`, { headers: { [PIN_HEADER]: TEST_PIN } })
    expect(response.status).toBe(401)
  })
})
