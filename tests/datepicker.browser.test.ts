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

/** The control: a glyph beside the date, named for a screen reader. ADR-0020. */
function pickButton(page: Page) {
  return page.getByRole('button', { name: 'Datum wählen' })
}

/** The input the browser hangs its calendar from. In the page, never seen. */
function pickInput(page: Page) {
  return page.locator('.topbar__pick-input')
}

/**
 * Choosing a date, as the native picker does it.
 *
 * The popup is browser chrome and cannot be driven from here, so this does what it does on the way
 * out: set the value and let the change reach React. The native setter is needed because React
 * tracks the value it wrote and would swallow an assignment it did not see - a plain `el.value =`
 * fires nothing.
 */
async function choose(page: Page, value: string): Promise<void> {
  await pickInput(page).evaluate((element, next) => {
    const input = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

test('the picker opens on the day being looked at, not on today', async ({ page }) => {
  await stubDay(page)
  await page.goto('/?date=2026-08-13')
  await expect(pickInput(page)).toHaveValue('2026-08-13')

  // And it follows the board when the board moves by other means.
  await page.getByRole('button', { name: 'Nächste Woche' }).click()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 20. August 2026' })).toBeVisible()
  await expect(pickInput(page)).toHaveValue('2026-08-20')
})

test('the glyph is the only control, and it opens the browser picker', async ({ page }) => {
  // The popup is browser chrome, so what can be proved here is that pressing the glyph asks for
  // it. `showPicker` is recorded before the page runs rather than after, because the click and
  // the call happen in the same tick.
  await page.addInitScript(() => {
    const win = window as unknown as { __picked: number }
    win.__picked = 0
    HTMLInputElement.prototype.showPicker = function showPicker() {
      win.__picked += 1
    }
  })
  await stubDay(page)
  await page.goto('/?date=2026-08-13')

  await expect(pickButton(page)).toBeVisible()

  // The field that used to say the date a second time shows nothing now. Not `toBeHidden`, which a
  // 1px transparent element passes as visible - and not `display: none` either, which would be
  // simpler and would stop `showPicker` working. What is asserted is what a person would see.
  const shown = await pickInput(page).evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { opacity: getComputedStyle(element).opacity, width: Math.round(box.width) }
  })
  expect(shown.opacity).toBe('0')
  expect(shown.width).toBeLessThanOrEqual(2)

  await pickButton(page).click()
  expect(await page.evaluate(() => (window as unknown as { __picked: number }).__picked)).toBe(1)
})

test('the hidden input is not a second stop for the keyboard', async ({ page }) => {
  // Two tab stops for one control is clutter somebody has to walk through, so the input is out of
  // the tab order and out of the accessibility tree. The button carries the name.
  await stubDay(page)
  await page.goto('/?date=2026-08-13')

  expect(await pickInput(page).getAttribute('tabindex')).toBe('-1')
  expect(await pickInput(page).getAttribute('aria-hidden')).toBe('true')
  await expect(page.getByRole('textbox', { name: 'Datum wählen' })).toHaveCount(0)
})

test('picking a date moves the board, the heading and the address bar', async ({ page }) => {
  const asked = await stubDay(page)
  await page.goto('/?date=2026-08-13')

  // Months away, which is the reason this exists: eight week-clicks or sixty day-clicks otherwise.
  await choose(page, '2026-10-14')

  await expect(page.getByRole('heading', { name: 'Mittwoch, 14. Oktober 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-10-14')
  expect(asked).toContain('2026-10-14')
})

test('a picked date survives a reload, because it is in the address bar', async ({ page }) => {
  await stubDay(page)
  await page.goto('/?date=2026-08-13')
  await choose(page, '2027-01-01')
  await expect(page.getByRole('heading', { name: 'Freitag, 1. Januar 2027' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Freitag, 1. Januar 2027' })).toBeVisible()
  await expect(pickInput(page)).toHaveValue('2027-01-01')

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

  await choose(page, '')

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

  await choose(page, '0050-03-15')

  await page.waitForTimeout(300)
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(asked.length).toBe(before)
})
