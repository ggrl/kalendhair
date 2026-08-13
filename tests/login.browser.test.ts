import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// The login screen in a real browser. The API is stubbed, as everywhere in this file's
// neighbours: what is proved here is that the board answers a 401 with somewhere to type the
// password, and that a successful login is answered by the board rather than by the same form
// again. What a 401 actually costs an attacker is proved against Postgres in auth.db.test.ts.

const EMPTY_DAY: Day = {
  date: '2026-08-13',
  today: '2026-08-13',
  employees: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Marco' }],
  entries: [],
}

/**
 * A server that refuses until the right password arrives.
 *
 * `signedIn` is the whole state: the browser holds no session of its own, because the real
 * cookie is httpOnly and the board is not allowed to keep its own opinion about whether it has
 * one - it asks for a day and believes the answer.
 */
async function stubApi(page: Page, password: string): Promise<void> {
  let signedIn = false

  await page.route('**/api/login', async (route) => {
    const sent = route.request().postDataJSON() as { password?: string }
    if (sent.password !== password) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Das Passwort stimmt nicht.' }) })
      return
    }
    signedIn = true
    await route.fulfill({ status: 204, body: '' })
  })

  await page.route('**/api/credentials/reset', async (route) => {
    const sent = route.request().postDataJSON() as { master?: string }
    if (sent.master !== 'test-master-password') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Das Hauptpasswort stimmt nicht.' }) })
      return
    }
    await route.fulfill({ status: 204, body: '' })
  })

  await page.route('**/api/day*', async (route) => {
    if (!signedIn) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Bitte anmelden.' }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_DAY) })
  })
}

test('asks for the password instead of showing a failed load', async ({ page }) => {
  await stubApi(page, 'test-salon-password')
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Terminplan' })).toBeVisible()
  await expect(page.getByLabel('Salon-Passwort')).toBeVisible()
  // The board's own failure text would send somebody to look at the server for a board that is
  // merely locked.
  await expect(page.getByText('Laden fehlgeschlagen')).toHaveCount(0)
})

test('shows the board once the password is right', async ({ page }) => {
  await stubApi(page, 'test-salon-password')
  await page.goto('/')

  await page.getByLabel('Salon-Passwort').fill('test-salon-password')
  await page.getByRole('button', { name: 'Anmelden' }).click()

  await expect(page.getByRole('checkbox', { name: 'Ganzen Tag für Marco sperren' })).toBeVisible()
  await expect(page.getByLabel('Salon-Passwort')).toHaveCount(0)
})

test('says the password was wrong and stays on the form', async ({ page }) => {
  await stubApi(page, 'test-salon-password')
  await page.goto('/')

  await page.getByLabel('Salon-Passwort').fill('falsch')
  await page.getByRole('button', { name: 'Anmelden' }).click()

  await expect(page.getByRole('alert')).toHaveText('Das Passwort stimmt nicht.')
  await expect(page.getByLabel('Salon-Passwort')).toBeVisible()
})

test('a save that meets an ended session lands on the login screen, not in the form', async ({ page }) => {
  // The blocker a review pass found. A 401 arriving at a write used to become the form's own
  // "fix this field" refusal: red text inside a dialogue whose backdrop swallows every click
  // that could get out of it, over a board still showing every customer name.
  await stubApi(page, 'test-salon-password')
  await page.goto('/')
  await page.getByLabel('Salon-Passwort').fill('test-salon-password')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('checkbox', { name: 'Ganzen Tag für Marco sperren' })).toBeVisible()

  // Everybody is logged out - the master reset, or a session that ran out mid-shift.
  await page.route('**/api/entries*', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Bitte anmelden.' }) }),
  )
  await page.unroute('**/api/day*')
  await page.route('**/api/day*', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Bitte anmelden.' }) }),
  )

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })
  await page.getByLabel('Kundin / Kunde').fill('Anna Schmidt')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByLabel('Salon-Passwort')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Anna Schmidt')).toHaveCount(0)
})

test('reaches the master reset and comes back to a login that says what happened', async ({ page }) => {
  await stubApi(page, 'test-salon-password')
  await page.goto('/')

  await page.getByRole('button', { name: 'Passwort oder PIN vergessen?' }).click()
  await expect(page.getByRole('heading', { name: 'Passwort zurücksetzen' })).toBeVisible()

  await page.getByLabel('Hauptpasswort').fill('test-master-password')
  await page.getByLabel('Neues Salon-Passwort').fill('ein-neues-passwort')
  await page.getByLabel('Neue PIN (vier Ziffern)').fill('1357')
  await page.getByRole('button', { name: 'Zurücksetzen' }).click()

  // Back at the login screen, because the master password buys no session: ADR-0017.
  await expect(page.getByLabel('Salon-Passwort')).toBeVisible()
  await expect(page.getByText('Alle Geräte sind abgemeldet.')).toBeVisible()
})
