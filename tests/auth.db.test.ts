import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { SESSION_COOKIE, SESSION_LIFETIME_MS, issueSession } from '../server/session.js'
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

// ADR-0004 and ADR-0017, over HTTP against a real Postgres: what an unauthenticated request
// gets, what the password buys, and what changing it takes away.

const DAY = '2026-08-13'
const CUSTOMER = 'Anna Schmidt'

let pool: Pool
let server: Server
let base: string

beforeAll(async () => {
  pool = await testPool()
  await empty(pool)
  const marco = await addEmployee(pool, 'Marco', 1)
  await addAppointment(pool, marco, DAY, '10:00', '11:00', CUSTOMER, 'Farbe')
})

beforeEach(async () => {
  // A fresh row and a fresh app for every test: tests here change the password, and the
  // attempt limiter lives in the app instance and would otherwise carry a count between them.
  await pool.query('DELETE FROM salon_credential')
  await ensureCredentials(pool)

  server = createApp(pool, TEST_CONFIG).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  base = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
})

afterAll(async () => {
  await pool.end()
})

async function login(password: string): Promise<Response> {
  return fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

async function reset(body: unknown): Promise<Response> {
  return fetch(`${base}/api/credentials/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The `name=value` pair out of a Set-Cookie header, ready to send back. */
function cookieFrom(response: Response): string {
  const header = response.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`))
  if (header === undefined) throw new Error('no session cookie was set')
  return header.split(';')[0]
}

describe('without a session', () => {
  it('answers no day, and no customer name in the refusal', async () => {
    const response = await fetch(`${base}/api/day?date=${DAY}`)

    expect(response.status).toBe(401)
    // ADR-0004: not a filtered day, not an empty shell that leaks names in an error, nothing.
    const body = await response.text()
    expect(body).not.toContain(CUSTOMER)
    expect(JSON.parse(body)).toEqual({ error: 'Bitte anmelden.' })
  })

  it('answers no suggestions, which are customer names by another route', async () => {
    const response = await fetch(`${base}/api/suggestions?field=customer&q=ann`)
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain(CUSTOMER)
  })

  it('refuses every write', async () => {
    const post = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(post.status).toBe(401)

    const patch = await fetch(`${base}/api/entries/11111111-1111-1111-1111-111111111111`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    })
    expect(patch.status).toBe(401)

    const remove = await fetch(`${base}/api/entries/11111111-1111-1111-1111-111111111111?version=1`, {
      method: 'DELETE',
    })
    expect(remove.status).toBe(401)
  })

  it('still serves what is not the API, or nobody could reach the login screen', async () => {
    // The guard is mounted on /api alone. The built board is HTML and JavaScript with no salon
    // data in it; locking it would leave a browser with nowhere to type the password.
    const response = await fetch(`${base}/not-a-file-in-dist`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found' })
  })

  it('refuses a cookie signed by somebody else', async () => {
    const forged = issueSession('another-signing-key-entirely-x', 1, Date.now())
    const response = await fetch(`${base}/api/day?date=${DAY}`, {
      headers: { cookie: `${SESSION_COOKIE}=${forged}` },
    })
    expect(response.status).toBe(401)
  })

  it('refuses a session that has run out', async () => {
    const expired = issueSession(TEST_CONFIG.sessionSecret, 1, Date.now() - SESSION_LIFETIME_MS - 1000)
    const response = await fetch(`${base}/api/day?date=${DAY}`, {
      headers: { cookie: `${SESSION_COOKIE}=${expired}` },
    })
    expect(response.status).toBe(401)
  })
})

describe('logging in', () => {
  it('exchanges the salon password for a cookie that opens the day', async () => {
    const response = await login(TEST_PASSWORD)
    expect(response.status).toBe(204)

    const day = await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie: cookieFrom(response) } })
    expect(day.status).toBe(200)
    expect((await day.json()).entries[0].customer).toBe(CUSTOMER)
  })

  it('sets a cookie the page cannot read and another site cannot use', async () => {
    const header = (await login(TEST_PASSWORD)).headers.getSetCookie()[0]

    // httpOnly is what keeps the session out of reach of anything that ends up running on the
    // page; SameSite is what stops another site spending it. ADR-0004 asks for both by name.
    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/SameSite=Lax/i)
    expect(header).toMatch(new RegExp(`Max-Age=${SESSION_LIFETIME_MS / 1000}`))
    // Not Secure here, and that is the config, not an oversight: these tests speak plain HTTP
    // to loopback, exactly as stage one does, and a Secure cookie would never come back.
    expect(header).not.toMatch(/Secure/i)
  })

  it('refuses the wrong password and hands out nothing', async () => {
    const response = await login('not-the-salon-password')
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toHaveLength(0)
    expect(await response.json()).toEqual({ error: 'Das Passwort stimmt nicht.' })
  })

  it('refuses a login with no password rather than treating it as an empty one', async () => {
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(401)
  })

  it('stops answering after too many attempts from one address', async () => {
    // ADR-0004: one shared password is one guessable secret in front of everything.
    let last = await login('wrong')
    for (let attempt = 0; attempt < 25 && last.status !== 429; attempt += 1) {
      last = await login('wrong')
    }

    expect(last.status).toBe(429)
    // And the limit is on the door, not on the password: the right one is refused too, which
    // is what stops somebody spending the budget and then walking through.
    expect((await login(TEST_PASSWORD)).status).toBe(429)
  })
})

describe('resetting with the master password', () => {
  const CHANGED = 'ein-neues-salon-passwort'

  it('sets a new password and a new PIN, and hands back no session', async () => {
    const response = await reset({ master: TEST_CONFIG.masterPassword, password: CHANGED, pin: '1357' })

    expect(response.status).toBe(204)
    // ADR-0017: the master password opens one screen and gets no board session. Whoever used
    // it logs in with the password they just set, like everybody else.
    expect(response.headers.getSetCookie()).toHaveLength(0)

    expect((await login(CHANGED)).status).toBe(204)
    expect((await login(TEST_PASSWORD)).status).toBe(401)
  })

  it('logs everybody out, including sessions that were valid a moment ago', async () => {
    // The reason a salon password gets changed is that somebody left. A cookie signed only by
    // the session secret would outlive the change, which is what the credential version is for.
    const before = cookieFrom(await login(TEST_PASSWORD))
    expect((await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie: before } })).status).toBe(200)

    await reset({ master: TEST_CONFIG.masterPassword, password: CHANGED, pin: '1357' })

    expect((await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie: before } })).status).toBe(401)
  })

  it('refuses the wrong master password and changes nothing', async () => {
    const response = await reset({ master: 'not-the-master-password', password: CHANGED, pin: '1357' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Das Hauptpasswort stimmt nicht.' })
    // The old password still works, which is the half that would be quiet if it did not.
    expect((await login(TEST_PASSWORD)).status).toBe(204)
  })

  it('refuses a password or a PIN the settings screen would also refuse', async () => {
    const short = await reset({ master: TEST_CONFIG.masterPassword, password: 'kurz', pin: '1357' })
    expect(short.status).toBe(400)
    expect((await short.json()).error).toMatch(/mindestens/)

    const pin = await reset({ master: TEST_CONFIG.masterPassword, password: CHANGED, pin: '13' })
    expect(pin.status).toBe(400)
    expect((await pin.json()).error).toMatch(/vier Ziffern/)

    // Neither attempt landed.
    expect((await login(TEST_PASSWORD)).status).toBe(204)
  })

  it('leaves a session that was issued after the change alone', async () => {
    // The version is checked, not merely different from one: a change must not invalidate the
    // cookie the next person gets.
    await reset({ master: TEST_CONFIG.masterPassword, password: CHANGED, pin: TEST_PIN })
    const after = cookieFrom(await login(CHANGED))

    expect((await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie: after } })).status).toBe(200)
    // And the helper other test files rely on tracks the row rather than assuming version 1.
    const minted = await sessionHeader(pool)
    expect((await fetch(`${base}/api/day?date=${DAY}`, { headers: { cookie: minted } })).status).toBe(200)
  })
})
