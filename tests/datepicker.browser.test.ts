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

test('a click focuses the field, because that is what opens the picker on an iPhone', async ({ page }) => {
  // iOS Safari has `showPicker` and it opens nothing for a date field - WebKit bug 261703, still
  // open. Its pickers are tied to focus, so the click has to focus the field. Every click, because
  // iOS 26 reports a finger's click as `pointerType` "mouse": a first fix that focused only on
  // "touch" changed nothing on the owner's iPhone. No iPhone runs here: what is proved is that the
  // click focuses, and the owner saw focus open the wheel on their phone.
  await stubDay(page)
  await page.goto('/?date=2026-08-13')

  await pickButton(page).click()
  await expect(pickInput(page)).toBeFocused()
})

// Both ways in, because Chromium treats them differently: after a tap, Tab starts from the hidden
// field rather than the button, and a tap is how the salon's touchscreen PC opens the picker.
for (const how of ['click', 'tap'] as const) {
  test(`after the picker, the keyboard belongs to the board again (${how})`, async ({ browser }) => {
    // Focus stays in the hidden field after the popup closes. Before the hand-off, measured here:
    // close the popup, ArrowUp, and the field raised its focused segment and the board jumped with
    // it - while ArrowRight did nothing at all.
    const context = await browser.newContext({ hasTouch: how === 'tap' })
    const page = await context.newPage()
    await stubDay(page)
    await page.goto('/?date=2026-08-13')
    const open = () => (how === 'tap' ? pickButton(page).tap() : pickButton(page).click())

    await open()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowUp')
    // Settled rather than asserted instantly: "nothing moved" passes for free before anything could.
    await page.waitForTimeout(300)
    await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
    await expect(pickInput(page)).not.toBeFocused()

    await open()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()

    // Found by a review pass on a version that only blurred the field: the next Tab walked
    // straight back into it, and ArrowUp raised its month to 14 September.
    await open()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(300)
    await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
    await expect(pickInput(page)).not.toBeFocused()
    await context.close()
  })
}

test('the field the calendar hangs from sits on the glyph, at every width', async ({ page }) => {
  // The owner found this by opening the picker: the calendar appeared about 400px to the right of
  // the button that opened it, and off the edge of a narrow window.
  //
  // The browser hangs its popup off the INPUT, wherever that is. The input was positioned against
  // `.topbar__heading`, which was the middle column of a three-column bar - close enough to the
  // glyph that nobody noticed. Then the top bar was rearranged and the date block grew to span the
  // whole width, so `right: 0` became the far right of the screen: measured at 573px away on a
  // 1440px window.
  //
  // The popup itself is browser chrome and Playwright cannot see it, so what is asserted is the
  // thing it anchors to. Several widths, because one width is exactly how this got through.
  await stubDay(page)
  await page.goto('/?date=2026-08-13')
  await expect(pickButton(page)).toBeVisible()

  for (const width of [1600, 1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    const placed = await page.evaluate(() => {
      const glyph = document.querySelector('.topbar__pick')!.getBoundingClientRect()
      const field = document.querySelector('.topbar__pick-input')!.getBoundingClientRect()
      return {
        inside:
          field.x >= glyph.x - 1 &&
          field.right <= glyph.right + 1 &&
          field.y >= glyph.y - 1 &&
          field.bottom <= glyph.bottom + 1,
        away: Math.round(Math.abs(field.x - glyph.x)),
        onScreen: field.right <= window.innerWidth,
      }
    })
    expect(placed.inside, `at ${width}px the field is ${placed.away}px from the glyph`).toBe(true)
    expect(placed.onScreen, `at ${width}px the field is off the screen`).toBe(true)
  }
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
