import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// Arrow keys move the day, Shift+arrow the week. The brief listed this as unbuilt navigation and
// the interview settled the three conflicts: the board's own sideways scrolling loses, a held key
// moves one day rather than sixty, and up and down are left alone.

const TODAY = '2026-08-13'

/** Six, so the board is wider than the pane and arrow keys have a scrollport to fight over. */
const STAFF = ['Marco', 'Elif', 'Jana', 'Aaron', 'Sabine', 'Tobias'].map((name, index) => ({
  id: `${index + 1}1111111-1111-1111-1111-111111111111`,
  name,
}))

async function stub(page: Page): Promise<void> {
  await page.route('**/api/day*', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    const day: Day = {
      date,
      today: TODAY,
      coreHours: { from: '09:00', to: '18:00' },
      employees: STAFF,
      entries: [
        {
          id: 'a1',
          version: 1,
          employeeId: STAFF[0].id,
          kind: 'appointment',
          startsAt: '09:00',
          endsAt: '10:00',
          customer: 'Anna Schmidt',
          treatment: 'Farbe',
          notes: null,
          reason: null,
          colour: '#f4b8b8',
        },
      ],
    }
    await route.fulfill({ json: day })
  })
  await page.route('**/api/suggestions*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
}

test.beforeEach(async ({ page }) => {
  await stub(page)
})

test('left and right move one day, and the address bar follows', async ({ page }) => {
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-14')

  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-13')
})

test('shift moves a week and keeps the weekday', async ({ page }) => {
  // The reason week steps exist at all: "the same slot in four weeks" lands on a Thursday
  // every time. ADR-0010 owns that arithmetic and this only reaches it from the keyboard.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 20. August 2026' })).toBeVisible()

  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 6. August 2026' })).toBeVisible()
})

test('a held key moves one day, not sixty', async ({ page }) => {
  // A key repeats about thirty times a second and every real step pushes one history entry, so
  // two seconds of leaning on the arrow would bury Back. Playwright cannot make the operating
  // system auto-repeat, so this dispatches the event the browser sends when it does - the same
  // key, with `repeat` set - which is exactly what the guard reads.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()

  await page.evaluate(() => {
    for (let i = 0; i < 20; i += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true }))
    }
  })

  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-14')

  // And Back is still one press from where it started, which is the point of refusing repeats.
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
})

test('the form owns the keyboard while it is open', async ({ page }) => {
  // `EntryModal.tsx` records what a stray arrow key can do to a form: one ArrowDown on the Person
  // select silently reassigns the stylist. So the day must not move underneath an open form
  // either - the form captured its date when it opened, and the board changing behind it is the
  // divergence that made a save land on the wrong day.
  await page.goto(`/?date=${TODAY}`)
  await page.getByRole('button', { name: /Anna Schmidt/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')

  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe(TODAY)

  // With focus on a button rather than a field, which is the press only the form guard catches.
  // The form opens with the customer field focused, so the two presses above are stopped by the
  // rule about typing - and a handler that had dropped the form guard entirely would still pass
  // them. This is the same press from Abbrechen, where nothing is being typed.
  await page.getByRole('button', { name: 'Abbrechen' }).focus()
  await page.keyboard.press('ArrowRight')

  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe(TODAY)
})

test('a day cannot change under a drag in flight', async ({ page }) => {
  // ADR-0019 for the poll: nothing may redraw the board under a moving box. A day change is a
  // redraw, and this one would be asked for by the same pair of hands doing the dragging.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  // Anchored to a visible hour rather than to an offset from the column's own top. The board
  // opens at 08:00 now, so the grid starts above the pane and a fixed offset lands on the sticky
  // column headings - where a press starts no gesture at all, and this test passed for the wrong
  // reason until it was measured.
  const column = (await page.locator('.board__column').first().boundingBox())!
  const ten = (await page.getByText('10:00', { exact: true }).boundingBox())!
  const x = column.x + column.width / 2

  await page.mouse.move(x, ten.y + 6)
  await page.mouse.down()
  // More than one move, or there is no gesture to be in flight: the board only counts a drag once
  // the pointer has travelled.
  await page.mouse.move(x, ten.y + 70, { steps: 6 })

  await page.keyboard.press('ArrowRight')
  expect(new URL(page.url()).searchParams.get('date')).toBe(TODAY)
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  // Released outside the assertion so the drag does not leak into the next test: this one ends by
  // proposing a new appointment, which is the form opening rather than a write.
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toBeVisible()
})

test('an arrow inside the open picker moves one day, not two', async ({ page }) => {
  // A review pass reported that the board steps behind the open picker, and asked for a guard on
  // the glyph button. Measured before building one, and the mechanism is not what it looked like:
  // a capture-phase listener on `window` sees NO keydown at all while the popup is open. The
  // native calendar takes the key, moves its own selection, fires `change`, and the board follows
  // through `onPick` - ADR-0020 working exactly as written.
  //
  // The reviewer's own numbers say so on a second reading: the date moved one day per press and
  // ignored Shift, and the handler in `App.tsx` makes Shift a week.
  //
  // So what is worth pinning is not a guard but the absence of a double step: if this handler ever
  // starts seeing those keys too, the day jumps by two, or by eight on the second press.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  await page.getByRole('button', { name: 'Datum wählen' }).click()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()

  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByRole('heading', { name: 'Samstag, 15. August 2026' })).toBeVisible()
})

test('with focus inside the board the day moves and the board does not scroll sideways', async ({ page }) => {
  // The conflict the owner settled: six stylists do not fit, so the pane is a horizontal
  // scrollport and arrow keys are what a browser scrolls one with. Navigation wins.
  //
  // What this proves and what it does not: removing the `preventDefault` in `App.tsx` does not
  // make it fail, because Chromium was measured not to scroll the pane sideways in this
  // configuration anyway. It pins the outcome - the day moves, the board stays put - and the line
  // it does not exercise is marked as insurance where it is written.
  await page.setViewportSize({ width: 700, height: 800 })
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const scrolls = await page.locator('.shell__day').evaluate((pane) => pane.scrollWidth > pane.clientWidth)
  expect(scrolls).toBe(true)

  await page.getByRole('button', { name: /Anna Schmidt/ }).first().focus()
  await page.keyboard.press('ArrowRight')

  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
  const sideways = await page.locator('.shell__day').evaluate((pane) => pane.scrollLeft)
  expect(sideways).toBe(0)
})

test('up and down still scroll the board through the day', async ({ page }) => {
  // The board opens at 08:00, so scrolling down is how a keyboard reaches the evening. Taking
  // these two keys as well would have closed the only route to it.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  await page.getByRole('button', { name: /Anna Schmidt/ }).first().focus()
  const before = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')

  await expect
    .poll(async () => page.locator('.shell__day').evaluate((pane) => pane.scrollTop))
    .toBeGreaterThan(before)
  // And the day did not move while they did it.
  expect(new URL(page.url()).searchParams.get('date')).toBe(TODAY)
})

test('a modifier leaves the press to the browser', async ({ page }) => {
  // Alt+Left, Cmd+Left and Ctrl+Left already mean something - Back, and jump a word. Ctrl is the
  // one of the three safe to press in a test: the other two are browser history navigation, which
  // would move the board by a route that has nothing to do with this code.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  // Twice in the same direction, deliberately. Pressing right then left was the first version of
  // this test, and it could not fail: a day forward and a day back land where they started, so a
  // handler ignoring the modifier passed it exactly like one respecting it.
  await page.keyboard.press('Control+ArrowRight')
  await page.keyboard.press('Control+ArrowRight')

  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe(TODAY)
})
