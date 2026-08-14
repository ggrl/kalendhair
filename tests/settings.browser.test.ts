import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import type { CoreHoursDay, Day, StaffMember } from '../src/calendar/types.js'
import { PIN_HEADER } from '../src/calendar/types.js'

// ADR-0018's screen in a real browser. The API is stubbed, as everywhere in this folder: what is
// proved here is what the screen does, and what the rules actually are is proved against Postgres
// in settings.db.test.ts.

const PIN = '2468'

const DAY: Day = {
  date: '2026-08-13',
  today: '2026-08-13',
  coreHours: { from: '09:00', to: '18:00' },
  employees: [{ id: 'marco', name: 'Marco' }],
  entries: [],
}

/** The week the stubbed server holds: the salon's own, with Monday and Sunday shut. */
const WEEK: CoreHoursDay[] = [
  { weekday: 1, hours: null },
  { weekday: 2, hours: { from: '09:00', to: '18:00' } },
  { weekday: 3, hours: { from: '09:00', to: '18:00' } },
  { weekday: 4, hours: { from: '09:00', to: '18:00' } },
  { weekday: 5, hours: { from: '09:00', to: '18:00' } },
  { weekday: 6, hours: { from: '08:00', to: '13:30' } },
  { weekday: 7, hours: null },
]

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
    if (request.url().endsWith('/hours') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WEEK) })
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
  // Exact, because the Kernzeiten section has a Speichern of its own and a loose match finds both.
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()

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

test('a mistyped repeat is caught here, because getting it wrong locks the salon out', async ({ page }) => {
  // The one field in this application that is typed twice. One masked input, one typo, and the
  // whole salon is logged out of a board whose password nobody knows - the way back is the master
  // password out of the environment, which on a VPS means somebody with shell access.
  const seen = await stubApi(page)
  await openSettings(page)

  await page.getByLabel('Neues Salon-Passwort', { exact: true }).fill('ein-neues-passwort')
  await page.getByLabel('Neues Salon-Passwort wiederholen').fill('ein-neues-passwrot')
  await page.getByRole('button', { name: 'Passwort ändern' }).click()

  await expect(page.getByText('Die beiden Passwörter sind nicht gleich.')).toBeVisible()
  expect(seen.filter((request) => request.url().endsWith('/password'))).toHaveLength(0)
  // Still here, with what was typed, rather than thrown back to a login screen.
  await expect(page.getByRole('heading', { name: 'Mitarbeiterinnen' })).toBeVisible()
})

test('changing the salon password lands on the login screen, because it logs everybody out', async ({ page }) => {
  await stubApi(page)
  await openSettings(page)

  await page.getByLabel('Neues Salon-Passwort', { exact: true }).fill('ein-neues-passwort')
  await page.getByLabel('Neues Salon-Passwort wiederholen').fill('ein-neues-passwort')
  await page.getByRole('button', { name: 'Passwort ändern' }).click()

  // ADR-0017 makes this end every session including this one, and the screen warned before the
  // click. What must not happen is the settings screen sitting there with an error on it.
  await expect(page.getByRole('heading', { name: 'Terminplan' })).toBeVisible()
  await expect(page.getByLabel('Salon-Passwort', { exact: true })).toBeVisible()
})

test('shows the week as it stands, and says what the hours do not do', async ({ page }) => {
  await stubApi(page)
  await openSettings(page)

  await expect(page.getByRole('heading', { name: 'Kernzeiten' })).toBeVisible()

  // The sentence exists because this screen is exactly where somebody concludes that editing
  // opening times will start refusing bookings. ADR-0015 says it never does.
  await expect(page.getByText('färben nur den Kalender')).toBeVisible()
  await expect(page.getByText('von 06:00 bis 20:00 möglich')).toBeVisible()

  await expect(page.getByLabel('Samstag von')).toHaveValue('08:00')
  await expect(page.getByLabel('Samstag bis')).toHaveValue('13:30')

  // A closed day says so with the tick and shows no times at all - two ways to say "shut" is how
  // they end up disagreeing.
  await expect(page.getByLabel('Sonntag von')).toHaveCount(0)
  await expect(page.getByLabel('Montag von')).toHaveCount(0)
})

test('saves the whole week in one request, not the day that changed', async ({ page }) => {
  // The owner chose one button over a save per row: somebody sits down once a year and fixes the
  // hours, and the server writes all seven or none of them.
  const seen = await stubApi(page)
  await openSettings(page)

  await page.getByLabel('Samstag bis').selectOption('12:00')
  await page.getByRole('button', { name: 'Kernzeiten speichern' }).click()

  await expect.poll(() => seen.filter((request) => request.method() === 'PUT').length).toBe(1)
  const put = seen.find((request) => request.method() === 'PUT')
  expect(put?.url()).toContain('/api/settings/hours')
  expect(put?.postDataJSON()).toEqual({
    week: [
      { weekday: 1, hours: null },
      { weekday: 2, hours: { from: '09:00', to: '18:00' } },
      { weekday: 3, hours: { from: '09:00', to: '18:00' } },
      { weekday: 4, hours: { from: '09:00', to: '18:00' } },
      { weekday: 5, hours: { from: '09:00', to: '18:00' } },
      { weekday: 6, hours: { from: '08:00', to: '12:00' } },
      { weekday: 7, hours: null },
    ],
  })
})

test('ticking Geschlossen takes the times away and sends null', async ({ page }) => {
  const seen = await stubApi(page)
  await openSettings(page)

  const saturday = page.getByRole('listitem').filter({ hasText: 'Samstag' })
  await saturday.getByRole('checkbox').check()
  await expect(page.getByLabel('Samstag von')).toHaveCount(0)

  await page.getByRole('button', { name: 'Kernzeiten speichern' }).click()

  await expect.poll(() => seen.filter((request) => request.method() === 'PUT').length).toBe(1)
  const sent = seen.find((request) => request.method() === 'PUT')?.postDataJSON() as {
    week: { weekday: number; hours: unknown }[]
  }
  expect(sent.week.find((day) => day.weekday === 6)?.hours).toBeNull()
})

test('unticking a closed day offers a working day rather than an empty pair of times', async ({ page }) => {
  // There is no such thing as a half-set day - the table refuses one - so unticking has to put
  // something in both dropdowns. The salon's own ordinary day is the least surprising answer.
  await stubApi(page)
  await openSettings(page)

  const sunday = page.getByRole('listitem').filter({ hasText: 'Sonntag' })
  await sunday.getByRole('checkbox').uncheck()

  await expect(page.getByLabel('Sonntag von')).toHaveValue('09:00')
  await expect(page.getByLabel('Sonntag bis')).toHaveValue('18:00')
})
