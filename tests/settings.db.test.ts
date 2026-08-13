import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { currentVersion } from '../server/credentials.js'
import type { StaffMember } from '../src/calendar/types.js'
import { PIN_HEADER } from '../src/calendar/types.js'
import {
  TEST_CONFIG,
  TEST_PASSWORD,
  TEST_PIN,
  addAppointment,
  addEmployee,
  empty,
  ensureCredentials,
  sessionHeader,
  testPool,
} from './db-helper.js'

// ADR-0018's screen, over HTTP against a real Postgres. The rules being tested are the ones the
// database enforces - the foreign key that decides who may be deleted, and `position` deciding
// column order - so both halves have to be real.

const DAY = '2026-08-13'

let pool: Pool
let server: Server
let base: string
let cookie: string

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

async function staff(): Promise<StaffMember[]> {
  return (await (await settings('/staff')).json()) as StaffMember[]
}

async function names(): Promise<string[]> {
  return (await staff()).map((person) => person.name)
}

/** The columns the board would draw, in the order it would draw them. */
async function boardColumns(): Promise<string[]> {
  const day = (await (await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie } })).json()) as {
    employees: { name: string }[]
  }
  return day.employees.map((employee) => employee.name)
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
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
  await pool.end()
})

beforeEach(async () => {
  await empty(pool)
  await pool.query('DELETE FROM salon_credential')
  await ensureCredentials(pool)
  // Minted after the credential row is rebuilt, so it carries the version the guard will read.
  cookie = await sessionHeader(pool)
})

describe('the PIN guard', () => {
  it('refuses every settings route without the PIN', async () => {
    // Every route, not a sample. They are all covered by one `app.use` today, which is exactly
    // the kind of thing that stops being true when somebody adds a route in the wrong place.
    const id = await addEmployee(pool, 'Marco', 1)

    for (const [path, init] of [
      ['/unlock', { method: 'POST' }],
      ['/staff', {}],
      ['/staff', { method: 'POST', body: JSON.stringify({ name: 'X' }) }],
      [`/staff/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'X' }) }],
      [`/staff/${id}/move`, { method: 'POST', body: JSON.stringify({ direction: 'up' }) }],
      [`/staff/${id}`, { method: 'DELETE' }],
      ['/password', { method: 'POST', body: JSON.stringify({ password: 'lang-genug-hier' }) }],
      ['/pin', { method: 'POST', body: JSON.stringify({ pin: '1111' }) }],
    ] as const) {
      const response = await fetch(`${base}/api/settings${path}`, {
        ...init,
        headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), cookie },
      })
      expect(response.status).toBe(403)
    }
  })

  it('refuses a wrong PIN, and says which thing was wrong', async () => {
    const response = await settings('/unlock', { method: 'POST' }, '0000')

    // 403 and not 401. The difference is what the screen does next: a wrong PIN sends somebody
    // back to the PIN prompt, and an ended session sends them to the login screen. One status
    // for both would log people out of the board for a mistyped digit.
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Die PIN stimmt nicht.' })
  })

  it('asks for a session before it asks for the PIN', async () => {
    // The PIN is not the boundary between the salon and the internet: ADR-0017. Somebody with the
    // PIN and no session gets the same 401 as anybody else, and the settings routes never tell a
    // stranger whether their four digits were right.
    const response = await fetch(`${base}/api/settings/staff`, { headers: { [PIN_HEADER]: TEST_PIN } })
    expect(response.status).toBe(401)
  })

  it('lets the right PIN through, and says nothing else', async () => {
    const response = await settings('/unlock', { method: 'POST' })
    expect(response.status).toBe(204)
  })
})

describe('the staff list', () => {
  it('shows everybody in board order, including the people not on the board', async () => {
    await addEmployee(pool, 'Marco', 1)
    await addEmployee(pool, 'Jana', 2, false)

    // ADR-0012 takes an inactive employee off the board entirely, so this screen is the only
    // place they can be seen - and the only place anybody can bring them back.
    expect(await names()).toEqual(['Marco', 'Jana'])
    expect((await staff())[1].active).toBe(false)
  })

  it('marks who may be deleted, which is only somebody who never held an entry', async () => {
    const marco = await addEmployee(pool, 'Marco', 1)
    await addEmployee(pool, 'Neu', 2)
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'Anna Schmidt')

    const rows = await staff()
    expect(rows.find((person) => person.name === 'Marco')?.deletable).toBe(false)
    expect(rows.find((person) => person.name === 'Neu')?.deletable).toBe(true)
  })
})

describe('adding', () => {
  it('puts a new stylist at the end of the list', async () => {
    await addEmployee(pool, 'Marco', 1)
    expect((await settings('/staff', { method: 'POST', body: JSON.stringify({ name: 'Jana' }) })).status).toBe(201)

    expect(await names()).toEqual(['Marco', 'Jana'])
  })

  it('trims a name and refuses one that is not there', async () => {
    await settings('/staff', { method: 'POST', body: JSON.stringify({ name: '  Jana  ' }) })
    expect(await names()).toEqual(['Jana'])

    for (const name of ['', '   ', 'x'.repeat(41)]) {
      const response = await settings('/staff', { method: 'POST', body: JSON.stringify({ name }) })
      expect(response.status).toBe(400)
    }
    expect(await names()).toEqual(['Jana'])
  })
})

describe('renaming and deactivating', () => {
  it('renames without moving anybody, even where two positions are the same', async () => {
    // ADR-0002 chose `position` over the name for column order precisely so this is true. The
    // first version of this test used positions 1 and 2 and could not have failed: the ordering
    // broke its tie on the name, so renaming the middle of three rows that share a position moved
    // her column on every day of the board. A review pass found it against a real database.
    await addEmployee(pool, 'Aaron', 1)
    const bea = await addEmployee(pool, 'Bea', 1)
    await addEmployee(pool, 'Carla', 1)

    // Where positions tie the order is decided by the id, so it is stable but not predictable
    // from here - which is the point. What has to hold is that the rename does not disturb it.
    const before = await names()
    await settings(`/staff/${bea}`, { method: 'PATCH', body: JSON.stringify({ name: 'Zoe' }) })

    expect(await names()).toEqual(before.map((name) => (name === 'Bea' ? 'Zoe' : name)))
  })

  it('does not move a column on the board either', async () => {
    // The same claim, asked of the thing the salon actually looks at. These two queries order by
    // the same columns and have to keep agreeing.
    await addEmployee(pool, 'Aaron', 1)
    const bea = await addEmployee(pool, 'Bea', 1)
    await addEmployee(pool, 'Carla', 1)

    const before = await boardColumns()
    await settings(`/staff/${bea}`, { method: 'PATCH', body: JSON.stringify({ name: 'Zoe' }) })

    expect(await boardColumns()).toEqual(before.map((name) => (name === 'Bea' ? 'Zoe' : name)))
  })

  it('takes somebody off the board and puts them back', async () => {
    const marco = await addEmployee(pool, 'Marco', 1)

    await settings(`/staff/${marco}`, { method: 'PATCH', body: JSON.stringify({ active: false }) })
    expect((await staff())[0].active).toBe(false)
    // ADR-0012: the board stops drawing them, and this screen still shows them.
    expect((await (await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie } })).json()).employees).toHaveLength(0)

    await settings(`/staff/${marco}`, { method: 'PATCH', body: JSON.stringify({ active: true }) })
    expect((await staff())[0].active).toBe(true)
  })

  it('refuses a change that changes nothing, and a person who is gone', async () => {
    const marco = await addEmployee(pool, 'Marco', 1)

    expect((await settings(`/staff/${marco}`, { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(400)

    const missing = await settings('/staff/11111111-1111-1111-1111-111111111111', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'X' }),
    })
    expect(missing.status).toBe(404)
  })
})

describe('reordering', () => {
  const move = (id: string, direction: 'up' | 'down') =>
    settings(`/staff/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) })

  it('moves one step and stops at the ends', async () => {
    const marco = await addEmployee(pool, 'Marco', 1)
    const jana = await addEmployee(pool, 'Jana', 2)
    await addEmployee(pool, 'Aaron', 3)

    expect((await move(jana, 'up')).status).toBe(204)
    expect(await names()).toEqual(['Jana', 'Marco', 'Aaron'])

    await move(jana, 'down')
    expect(await names()).toEqual(['Marco', 'Jana', 'Aaron'])

    // Already first. Nothing happens, and it is not an error: the button is disabled there, so
    // arriving here means the screen was stale, and "that person is already first" is not news.
    expect((await move(marco, 'up')).status).toBe(204)
    expect(await names()).toEqual(['Marco', 'Jana', 'Aaron'])
  })

  it('sorts out positions that were never distinct in the first place', async () => {
    // Every employee row in this application was created by hand before this screen existed, and
    // nothing ever stopped two of them sharing a position. Swapping two rows' numbers would move
    // nobody here; renumbering the whole list makes it correct instead of assuming it was.
    await addEmployee(pool, 'Aaron', 1)
    await addEmployee(pool, 'Bea', 1)
    await addEmployee(pool, 'Carla', 1)

    // Whatever order the ids put them in, moving the last one up swaps it with the second.
    const before = await staff()
    const last = before[2]

    await move(last.id, 'up')
    expect(await names()).toEqual([before[0].name, last.name, before[1].name])

    const positions = await pool.query<{ position: number }>('SELECT position FROM employee ORDER BY position')
    expect(positions.rows.map((row) => row.position)).toEqual([1, 2, 3])
  })

  it('answers a made-up id with "gone" rather than a 500', async () => {
    // Postgres refuses to parse it as a uuid, which reached the client as an internal error with
    // a stack in the log. Both review passes found it. Nothing in the screen can produce one; the
    // API has a second consumer coming, and this is what it will be told.
    for (const path of ['/staff/not-a-uuid', '/staff/not-a-uuid/move']) {
      const response = await settings(path, {
        method: path.endsWith('move') ? 'POST' : 'DELETE',
        body: path.endsWith('move') ? JSON.stringify({ direction: 'up' }) : undefined,
      })
      expect(response.status).toBe(404)
    }

    const patch = await settings('/staff/not-a-uuid', { method: 'PATCH', body: JSON.stringify({ name: 'X' }) })
    expect(patch.status).toBe(404)
  })

  it('refuses a direction that is not one', async () => {
    const marco = await addEmployee(pool, 'Marco', 1)
    const response = await settings(`/staff/${marco}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction: 'sideways' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('deleting', () => {
  it('removes somebody who never held an entry', async () => {
    // ADR-0018's narrow exception to ADR-0002: a name typed wrong, or somebody who never started.
    const wrong = await addEmployee(pool, 'Marcoo', 1)

    expect((await settings(`/staff/${wrong}`, { method: 'DELETE' })).status).toBe(204)
    expect(await names()).toEqual([])
  })

  it('refuses anybody with history, and says to deactivate instead', async () => {
    const marco = await addEmployee(pool, 'Marco', 1)
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'Anna Schmidt')

    const response = await settings(`/staff/${marco}`, { method: 'DELETE' })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/deaktivieren/i)
    // The record that a real customer was served is what ADR-0002 exists to protect, so nothing
    // was deleted and nothing cascaded.
    expect(await names()).toEqual(['Marco'])
    expect((await pool.query('SELECT 1 FROM appointment')).rowCount).toBe(1)
  })
})

describe('the credentials', () => {
  it('changes the salon password and ends every session, including this one', async () => {
    const before = await currentVersion(pool)

    const response = await settings('/password', { method: 'POST', body: JSON.stringify({ password: 'neues-passwort-hier' }) })
    expect(response.status).toBe(204)

    // ADR-0017: the reason a shared password gets changed is that somebody left, so the cookie
    // that was valid a moment ago is not any more - the caller's own included.
    expect(await currentVersion(pool)).toBe(before + 1)
    expect((await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie } })).status).toBe(401)

    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'neues-passwort-hier' }),
    })
    expect(login.status).toBe(204)
  })

  it('changes the PIN and ends nothing', async () => {
    const before = await currentVersion(pool)

    expect((await settings('/pin', { method: 'POST', body: JSON.stringify({ pin: '1357' }) })).status).toBe(204)

    // No session was ever bought with a PIN, so there is nothing for a PIN change to revoke.
    expect(await currentVersion(pool)).toBe(before)
    expect((await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie } })).status).toBe(200)

    expect((await settings('/unlock', { method: 'POST' }, TEST_PIN)).status).toBe(403)
    expect((await settings('/unlock', { method: 'POST' }, '1357')).status).toBe(204)
  })

  it('holds both to the rules the screen shows', async () => {
    expect((await settings('/password', { method: 'POST', body: JSON.stringify({ password: 'kurz' }) })).status).toBe(400)
    expect((await settings('/pin', { method: 'POST', body: JSON.stringify({ pin: '13' }) })).status).toBe(400)

    // Neither landed: the old password and the old PIN both still work.
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    })
    expect(login.status).toBe(204)
    expect((await settings('/unlock', { method: 'POST' })).status).toBe(204)
  })
})
