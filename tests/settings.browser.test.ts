import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import type { Day, StaffMember } from '../src/calendar/types.js'
import { PIN_HEADER } from '../src/calendar/types.js'

// ADR-0018's screen in a real browser. The API is stubbed, as everywhere in this folder: what is
// proved here is what the screen does, and what the rules actually are is proved against Postgres
// in settings.db.test.ts.

const PIN = '2468'

const DAY: Day = {
  date: '2026-08-13',
  today: '2026-08-13',
  employees: [{ id: 'marco', name: 'Marco' }],
  entries: [],
}

const STAFF: StaffMember[] = [
  { id: 'marco', name: 'Marco', active: true, deletable: false },
  { id: 'jana', name: 'Jana', active: false, deletable: false },
  { id: 'neu', name: 'Neu', active: true, deletable: true },
]

/**
 * A server that knows the PIN and remembers what it was asked to do.
 *
 * `signedIn` starts true here - the login screen has its own file, and every test below begins on
 * a board somebody is already looking at.
 */
async function stubApi(page: Page): Promise<Request[]> {
  const seen: Request[] = []
  let signedIn = true

  await page.route('**/api/day*', async (route) => {
    if (!signedIn) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Bitte anmelden.' }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DAY) })
  })

  await page.route('**/api/settings/**', async (route) => {
    const request = route.request()

    // The session guard runs before the PIN guard on the server, so it does here: once the
    // password has changed, every settings request is refused for the same reason a day is.
    if (!signedIn) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Bitte anmelden.' }) })
      return
    }

    // The guard the server applies, applied here too - otherwise a screen that forgot to send the
    // PIN would pass every one of these tests.
    if (request.headers()[PIN_HEADER] !== PIN) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Die PIN stimmt nicht.' }) })
      return
    }

    if (request.method() !== 'GET') seen.push(request)

    // Changing the salon password ends every session. ADR-0017, and the screen has to survive it.
    if (request.url().endsWith('/password')) signedIn = false

    if (request.url().endsWith('/staff') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STAFF) })
      return
    }
    await route.fulfill({ status: 204, body: '' })
  })

  return seen
}

/** From the board to the staff list, through the PIN. */
async function openSettings(page: Page): Promise<void> {
  await page.goto('/?date=2026-08-13')
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.getByLabel('PIN').fill(PIN)
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByRole('heading', { name: 'Mitarbeiterinnen' })).toBeVisible()
}

test('asks for the PIN, and says so when it is wrong', async ({ page }) => {
  await stubApi(page)
  await page.goto('/?date=2026-08-13')

  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await expect(page.getByLabel('PIN')).toBeVisible()
  // Nothing behind the prompt: the staff list is not fetched until the PIN is accepted.
  await expect(page.getByRole('heading', { name: 'Mitarbeiterinnen' })).toHaveCount(0)

  await page.getByLabel('PIN').fill('0000')
  await page.getByRole('button', { name: 'Weiter' }).click()

  await expect(page.getByRole('alert')).toHaveText('Die PIN stimmt nicht.')
  await expect(page.getByLabel('PIN')).toBeVisible()
})

test('asks again every time the screen is opened', async ({ page }) => {
  // The owner chose this over anything longer-lived. It also means there is no ticket to leave
  // lying around on the front desk machine.
  await stubApi(page)
  await openSettings(page)

  await page.getByRole('button', { name: 'Zurück zum Kalender' }).click()
  await expect(page.getByRole('button', { name: 'Einstellungen' })).toBeVisible()

  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await expect(page.getByLabel('PIN')).toBeVisible()
})

test('shows everybody, marks who is off the board, and offers delete only where it is allowed', async ({ page }) => {
  await stubApi(page)
  await openSettings(page)

  await expect(page.getByText('Jana')).toBeVisible()
  await expect(page.getByText('(deaktiviert)')).toBeVisible()

  // ADR-0018's exception is narrow, and the screen says so by not offering the button. The
  // database refuses it either way; this is what stops somebody trying.
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Deaktivieren' })).toHaveCount(2)
})

test('renames somebody without moving them, and sends what was typed', async ({ page }) => {
  const seen = await stubApi(page)
  await openSettings(page)

  await page.getByRole('button', { name: 'Umbenennen' }).first().click()
  await page.getByLabel('Name von Marco').fill('Marco B.')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByLabel('Name von Marco')).toHaveCount(0)
  const patch = seen.find((request) => request.method() === 'PATCH')
  expect(patch?.url()).toContain('/api/settings/staff/marco')
  expect(patch?.postDataJSON()).toEqual({ name: 'Marco B.' })
})

test('asks before deleting, because deleting is the one thing here that does not come back', async ({ page }) => {
  const seen = await stubApi(page)
  await openSettings(page)

  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByText('Wirklich löschen?')).toBeVisible()
  expect(seen.filter((request) => request.method() === 'DELETE')).toHaveLength(0)

  await page.getByRole('button', { name: 'Ja, löschen' }).click()
  await expect.poll(() => seen.filter((request) => request.method() === 'DELETE').length).toBe(1)
})

test('the arrows stop at the ends of the list', async ({ page }) => {
  await stubApi(page)
  await openSettings(page)

  await expect(page.getByRole('button', { name: 'Marco nach oben' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Marco nach unten' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Neu nach unten' })).toBeDisabled()
})

test('changing the PIN asks for the new one straight away, and says why', async ({ page }) => {
  await stubApi(page)
  await openSettings(page)

  await page.getByLabel('Neue PIN (vier Ziffern)').fill('1357')
  await page.getByRole('button', { name: 'PIN ändern' }).click()

  // The PIN this screen was holding is now the old one, so it locks itself rather than letting
  // the next click fail for a reason nobody could guess.
  await expect(page.getByText('Die PIN wurde geändert. Bitte die neue PIN eingeben.')).toBeVisible()
  await expect(page.getByLabel('PIN')).toBeVisible()
})

test('changing the salon password lands on the login screen, because it logs everybody out', async ({ page }) => {
  await stubApi(page)
  await openSettings(page)

  await page.getByLabel('Neues Salon-Passwort').fill('ein-neues-passwort')
  await page.getByRole('button', { name: 'Passwort ändern' }).click()

  // ADR-0017 makes this end every session including this one, and the screen warned before the
  // click. What must not happen is the settings screen sitting there with an error on it.
  await expect(page.getByRole('heading', { name: 'Terminplan' })).toBeVisible()
  await expect(page.getByLabel('Salon-Passwort', { exact: true })).toBeVisible()
})
