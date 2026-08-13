import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { addAppointment, addEmployee, empty, testPool } from './db-helper.js'

// The write path, over HTTP, against a real Postgres. The rules being tested are enforced by
// the database and translated by the server, so both halves have to be real: a mock would only
// prove the mock agrees with itself.

const DAY = '2026-08-13'
const TZ = 'Europe/Berlin'

let pool: Pool
let server: Server
let base: string
let marco: string
let jana: string

interface Entry {
  id: string
  version: number
  employeeId: string
  kind: string
  startsAt: string
  endsAt: string
  customer: string | null
  treatment: string | null
  notes: string | null
  reason: string | null
}

async function post(body: unknown): Promise<Response> {
  return fetch(`${base}/api/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patch(id: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/entries/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function entriesOn(date: string): Promise<Entry[]> {
  const response = await fetch(`${base}/api/day?date=${date}`)
  return (await response.json()).entries
}

function appointment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    employeeId: marco,
    kind: 'appointment',
    date: DAY,
    startsAt: '10:00',
    endsAt: '11:00',
    customer: 'Anna Schmidt',
    treatment: 'Farbe',
    ...overrides,
  }
}

beforeAll(async () => {
  pool = await testPool()
  server = createApp(pool, TZ).listen(0, '127.0.0.1')
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

beforeEach(async () => {
  await empty(pool)
  marco = await addEmployee(pool, 'Marco', 1)
  jana = await addEmployee(pool, 'Jana', 2)
})

describe('creating', () => {
  it('books an appointment and shows it on the day', async () => {
    const response = await post(appointment())
    expect(response.status).toBe(201)

    const entries = await entriesOn(DAY)
    expect(entries).toHaveLength(1)
    expect(entries[0].customer).toBe('Anna Schmidt')
    expect(entries[0].startsAt).toBe('10:00')
    expect(entries[0].version).toBe(1)
  })

  it('books a block, which carries no customer', async () => {
    const response = await post({
      employeeId: jana,
      kind: 'block',
      date: DAY,
      startsAt: '12:00',
      endsAt: '13:00',
    })
    expect(response.status).toBe(201)

    const entries = await entriesOn(DAY)
    expect(entries[0].kind).toBe('block')
    expect(entries[0].customer).toBeNull()
  })

  it('books a block with a reason, and gives it back on the day', async () => {
    // ADR-0014. The reason is what the box shows in place of the word `Gesperrt`.
    const response = await post({
      employeeId: jana,
      kind: 'block',
      date: DAY,
      startsAt: '12:00',
      endsAt: '13:00',
      reason: '  Urlaub  ',
    })
    expect(response.status).toBe(201)

    const entries = await entriesOn(DAY)
    expect(entries[0].kind).toBe('block')
    expect(entries[0].reason).toBe('Urlaub')
    expect(entries[0].customer).toBeNull()
  })

  it('refuses a reason on an appointment, which has a treatment for that', async () => {
    const response = await post(appointment({ reason: 'Urlaub' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Nur eine Sperrzeit hat einen Grund/)
  })

  it('trims a name rather than storing the spaces', async () => {
    await post(appointment({ customer: '  Anna Schmidt  ' }))
    expect((await entriesOn(DAY))[0].customer).toBe('Anna Schmidt')
  })

  it('accepts an appointment with no treatment yet', async () => {
    // The receptionist has a name before the customer has decided.
    const response = await post(appointment({ treatment: '' }))
    expect(response.status).toBe(201)
    expect((await entriesOn(DAY))[0].treatment).toBeNull()
  })
})

describe('each refusal says which rule was broken', () => {
  it('refuses a clash, naming it as a clash', async () => {
    await post(appointment())
    const response = await post(appointment({ startsAt: '10:30', endsAt: '11:30', customer: 'Bea' }))

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/schon belegt/)
  })

  it('allows the same time for a different person', async () => {
    await post(appointment())
    expect((await post(appointment({ employeeId: jana, customer: 'Bea' }))).status).toBe(201)
  })

  it('allows a booking that starts where another ends', async () => {
    await post(appointment())
    expect((await post(appointment({ startsAt: '11:00', endsAt: '12:00', customer: 'Bea' }))).status).toBe(201)
  })

  it('refuses a drag that ended where it started, as a duration problem', async () => {
    const response = await post(appointment({ startsAt: '10:00', endsAt: '10:00' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Ende muss nach dem Beginn/)
  })

  it('refuses a time outside the bookable window', async () => {
    const early = await post(appointment({ startsAt: '05:00', endsAt: '06:00' }))
    expect(early.status).toBe(400)
    expect((await early.json()).error).toMatch(/06:00 und 20:00/)

    const late = await post(appointment({ startsAt: '19:30', endsAt: '20:30' }))
    expect(late.status).toBe(400)
  })

  it('refuses a time that is not on a quarter hour', async () => {
    const response = await post(appointment({ startsAt: '10:07', endsAt: '11:00' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Viertelstunde/)
  })

  it('refuses an appointment with no name', async () => {
    for (const customer of ['', '   ', null]) {
      const response = await post(appointment({ customer }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/Ohne Namen/)
    }
  })

  it('refuses a block that carries a name', async () => {
    const response = await post(appointment({ kind: 'block', customer: 'Anna', treatment: null }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Sperrzeit/)
  })

  it('refuses an unknown employee without leaking anything about the database', async () => {
    const response = await post(appointment({ employeeId: '99999999-9999-9999-9999-999999999999' }))
    expect(response.status).toBe(400)

    const body = await response.text()
    expect(JSON.parse(body).error).toMatch(/Person gibt es nicht/)
    expect(body).not.toMatch(/constraint|appointment_|fkey/)
  })

  it('refuses nonsense instead of guessing', async () => {
    expect((await post(appointment({ date: '2026-02-30' }))).status).toBe(400)
    expect((await post(appointment({ kind: 'holiday' }))).status).toBe(400)
    expect((await post(appointment({ startsAt: 'morgens' }))).status).toBe(400)
    expect((await post('not an object')).status).toBe(400)
  })
})

describe('changing', () => {
  it('moves an appointment to another person and time', async () => {
    const { id } = await (await post(appointment())).json()
    const response = await patch(id, appointment({ employeeId: jana, startsAt: '14:00', endsAt: '15:00', version: 1 }))

    expect(response.status).toBe(200)
    expect((await response.json()).version).toBe(2)

    const entries = await entriesOn(DAY)
    expect(entries[0].startsAt).toBe('14:00')
    expect(entries[0].employeeId ?? '').not.toBe(marco)
  })

  it('refuses a move onto a clash and leaves the appointment where it was', async () => {
    const { id } = await (await post(appointment())).json()
    await post(appointment({ employeeId: jana, startsAt: '14:00', endsAt: '15:00', customer: 'Bea' }))

    const response = await patch(id, appointment({ employeeId: jana, startsAt: '14:30', endsAt: '15:30', version: 1 }))

    expect(response.status).toBe(409)
    // The board springs the box back, so what the server holds has to be unchanged.
    const entries = await entriesOn(DAY)
    expect(entries.find((entry) => entry.id === id)?.startsAt).toBe('10:00')
    expect(entries.find((entry) => entry.id === id)?.version).toBe(1)
  })

  it('turns an appointment into a block', async () => {
    const { id } = await (await post(appointment())).json()
    const response = await patch(id, {
      employeeId: marco,
      kind: 'block',
      date: DAY,
      startsAt: '10:00',
      endsAt: '11:00',
      version: 1,
    })

    expect(response.status).toBe(200)
    const entries = await entriesOn(DAY)
    expect(entries[0].kind).toBe('block')
    expect(entries[0].customer).toBeNull()
  })
})

describe('ADR-0003: a save against a stale version is refused', () => {
  it('refuses the second of two saves that both read version 1', async () => {
    const { id } = await (await post(appointment())).json()

    const first = await patch(id, appointment({ startsAt: '14:00', endsAt: '15:00', version: 1 }))
    expect(first.status).toBe(200)

    // The second person read the appointment before the first saved, so their version is stale.
    const second = await patch(id, appointment({ startsAt: '16:00', endsAt: '17:00', version: 1 }))
    expect(second.status).toBe(409)
    expect((await second.json()).error).toMatch(/inzwischen geändert/)

    // The first save survives. Nothing is silently overwritten.
    expect((await entriesOn(DAY))[0].startsAt).toBe('14:00')
  })

  it('says so differently when the entry is gone rather than changed', async () => {
    const { id } = await (await post(appointment())).json()
    expect((await fetch(`${base}/api/entries/${id}?version=1`, { method: 'DELETE' })).status).toBe(204)

    const response = await patch(id, appointment({ version: 1 }))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/gelöscht/)
  })

  it('refuses a save with no version at all', async () => {
    const { id } = await (await post(appointment())).json()
    const response = await patch(id, appointment())

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Version/)
  })
})

describe('removing', () => {
  it('deletes an entry', async () => {
    const { id } = await (await post(appointment())).json()
    expect((await fetch(`${base}/api/entries/${id}?version=1`, { method: 'DELETE' })).status).toBe(204)
    expect(await entriesOn(DAY)).toHaveLength(0)
  })

  it('refuses to delete something somebody else has changed', async () => {
    const { id } = await (await post(appointment())).json()
    await patch(id, appointment({ startsAt: '14:00', endsAt: '15:00', version: 1 }))

    const response = await fetch(`${base}/api/entries/${id}?version=1`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(await entriesOn(DAY)).toHaveLength(1)
  })
})

describe('the whole-day block is one row and needs no rule of its own', () => {
  it('blocks an empty column', async () => {
    const response = await post({ employeeId: marco, kind: 'block', date: DAY, startsAt: '06:00', endsAt: '20:00' })
    expect(response.status).toBe(201)
  })

  it('is refused on a column that already has an appointment, and says why', async () => {
    await addAppointment(pool, marco, DAY, '14:00', '15:00', 'Anna')

    const response = await post({ employeeId: marco, kind: 'block', date: DAY, startsAt: '06:00', endsAt: '20:00' })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/schon belegt/)
  })
})
