import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// ADR-0020, in a real browser against a stubbed API. What is proved here is that picking a date
// moves the board and the address bar with it, and - the half that matters more - that the two
// ways of choosing nothing move nothing at all.

const MARCO = '11111111-1111-1111-1111-111111111111'
const TODAY = '2026-08-13'

async function stubDay(page: Page): Promise<string[]> {
  const asked: string[] = []
  await page.route('**/api/day*', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    asked.push(date)
    const day: Day = {
      date,
      today: TODAY,
      coreHours: { from: '09:00', to: '18:00' },
      employees: [{ id: MARCO, name: 'Marco' }],
      entries: [],
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(day) })
  })
  return asked
}

/** The picker, by its screen reader name - it has no visible label to click. */
function picker(page: Page) {
  return page.getByLabel('Datum wählen')
}

test('the picker opens on the day being looked at, not on today', async ({ page }) => {
  await stubDay(page)
  await page.goto('/?date=2026-08-13')
  await expect(picker(page)).toHaveValue('2026-08-13')

  // And it follows the board when the board moves by other means.
  await page.getByRole('button', { name: 'Nächste Woche' }).click()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 20. August 2026' })).toBeVisible()
  await expect(picker(page)).toHaveValue('2026-08-20')
})

test('picking a date moves the board, the heading and the address bar', async ({ page }) => {
  const asked = await stubDay(page)
  await page.goto('/?date=2026-08-13')

  // Months away, which is the reason this exists: eight week-clicks or sixty day-clicks otherwise.
  await picker(page).fill('2026-10-14')

  await expect(page.getByRole('heading', { name: 'Mittwoch, 14. Oktober 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-10-14')
  expect(asked).toContain('2026-10-14')
})

test('a picked date survives a reload, because it is in the address bar', async ({ page }) => {
  await stubDay(page)
  await page.goto('/?date=2026-08-13')
  await picker(page).fill('2027-01-01')
  await expect(page.getByRole('heading', { name: 'Freitag, 1. Januar 2027' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Freitag, 1. Januar 2027' })).toBeVisible()
  await expect(picker(page)).toHaveValue('2027-01-01')

  // ADR-0010's boundary, and the reason that date was chosen: 1 January 2027 is in ISO week 53
  // of 2026, so the week number and the year in the date disagree and the header must not "fix" it.
  await expect(page.locator('.topbar__week')).toContainText('KW 53')
})

test('clearing the picker moves nothing', async ({ page }) => {
  const asked = await stubDay(page)
  await page.goto('/?date=2026-08-13')
  // Settled before the baseline is taken. The board is served by the dev server under StrictMode,
  // which mounts effects twice, so requests are still landing right after `goto` - and counting
  // from a number that has not stopped moving makes the assertion below meaningless.
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  await page.waitForTimeout(300)
  const before = asked.length

  await picker(page).fill('')

  // Settled rather than asserted instantly: "nothing happened" is the assertion that passes for
  // free before anything has had a chance to happen.
  await page.waitForTimeout(300)
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-13')
  expect(asked.length).toBe(before)
})

test('a year the calendar cannot represent moves nothing', async ({ page }) => {
  // `Date.UTC(50, 0, 1)` means 1950, not year 50, so a two-digit year fails silently rather than
  // loudly - `isoWeek('0050-03-15')` returned KW -99126. `isSalonDate` refuses it, and the board
  // goes nowhere, exactly as a step off the end of the calendar already does.
  const asked = await stubDay(page)
  await page.goto('/?date=2026-08-13')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  await page.waitForTimeout(300)
  const before = asked.length

  await picker(page).fill('0050-03-15')

  await page.waitForTimeout(300)
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(asked.length).toBe(before)
})
