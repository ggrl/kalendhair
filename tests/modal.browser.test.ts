import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// The form, in a real browser, against a stubbed API. What is proved here is what the screen
// does with a refusal; that the refusals are real and correctly told apart is proved against a
// real Postgres in write.db.test.ts.

const MARCO = '11111111-1111-1111-1111-111111111111'
const JANA = '22222222-2222-2222-2222-222222222222'
const TODAY = '2026-08-13'
const YESTERDAY = '2026-08-12'

interface Recorded {
  method: string
  url: string
  body: unknown
}

function dayWith(entries: Day['entries']): Day {
  return {
    date: TODAY,
    today: TODAY,
    employees: [
      { id: MARCO, name: 'Marco' },
      { id: JANA, name: 'Jana' },
    ],
    entries,
  }
}

const ANNA: Day['entries'][number] = {
  id: 'a1',
  version: 3,
  employeeId: MARCO,
  kind: 'appointment',
  startsAt: '09:00',
  endsAt: '10:00',
  customer: 'Anna Schmidt',
  treatment: 'Farbe',
  notes: 'Reagiert auf Ammoniak',
  reason: null,
  colour: '#f4b8b8',
}

const HOLIDAY: Day['entries'][number] = {
  id: 'b2',
  version: 1,
  employeeId: JANA,
  kind: 'block',
  startsAt: '14:00',
  endsAt: '15:00',
  customer: null,
  treatment: null,
  notes: null,
  reason: 'Urlaub',
  colour: null,
}

const BLOCK: Day['entries'][number] = {
  id: 'b1',
  version: 1,
  employeeId: JANA,
  kind: 'block',
  startsAt: '12:00',
  endsAt: '13:00',
  customer: null,
  treatment: null,
  notes: null,
  reason: null,
  colour: null,
}

/**
 * Stubs the API and records every write. `writeReply` decides what a write is answered with, so
 * a test can make the server refuse without needing a real one.
 */
async function stub(
  page: Page,
  entries: Day['entries'],
  writeReply?: (route: Route) => Promise<void>,
): Promise<Recorded[]> {
  const seen: Recorded[] = []

  await page.route('**/api/suggestions*', async (route) => {
    await route.fulfill({ json: ['Anna Schmidt', 'Anneliese Bruck'] })
  })

  await page.route('**/api/day*', async (route) => {
    await route.fulfill({ json: dayWith(entries) })
  })

  // `*` stops at a slash, so `entries*` never matched `/api/entries/a1` and no PATCH or
  // DELETE was intercepted at all.
  await page.route('**/api/entries**', async (route) => {
    seen.push({
      method: route.request().method(),
      url: route.request().url(),
      body: route.request().postDataJSON(),
    })
    if (writeReply !== undefined) {
      await writeReply(route)
      return
    }
    await route.fulfill({ status: 201, json: { id: 'new' } })
  })

  return seen
}

/**
 * Like `stub`, but answers whichever date is asked for instead of always the same day, because
 * these tests turn on which day is on screen. Anna exists on TODAY only. `slowFrom` makes that
 * numbered day request onwards take two seconds, which is the window the board spends dimmed.
 */
async function stubDays(page: Page, slowFrom = Number.POSITIVE_INFINITY): Promise<Recorded[]> {
  const seen: Recorded[] = []
  let asks = 0

  await page.route('**/api/suggestions*', async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.route('**/api/day*', async (route) => {
    asks += 1
    if (asks >= slowFrom) await new Promise((resolve) => setTimeout(resolve, 2000))
    const asked = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    await route.fulfill({ json: { ...dayWith(asked === TODAY ? [ANNA] : []), date: asked } })
  })

  await page.route('**/api/entries**', async (route) => {
    seen.push({
      method: route.request().method(),
      url: route.request().url(),
      body: route.request().postDataJSON(),
    })
    await route.fulfill({ status: 200, json: { version: 4 } })
  })

  return seen
}

test('clicking an appointment opens it with its values, notes included', async ({ page }) => {
  await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()
  await expect(page.getByLabel('Kundin / Kunde')).toHaveValue('Anna Schmidt')
  await expect(page.getByLabel('Behandlung')).toHaveValue('Farbe')
  await expect(page.getByLabel('Notizen')).toHaveValue('Reagiert auf Ammoniak')
  await expect(page.getByLabel('Von')).toHaveValue('09:00')
  await expect(page.getByLabel('Bis')).toHaveValue('10:00')
})

test('clicking empty grid proposes that quarter hour and has nothing to delete', async ({ page }) => {
  await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  // 06:00 is the top of the board, so a click just inside the first column starts there.
  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })

  await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toBeVisible()
  await expect(page.getByLabel('Von')).toHaveValue('06:00')
  await expect(page.getByLabel('Bis')).toHaveValue('06:15')
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0)
})

test('saving a new appointment sends it and reloads the day', async ({ page }) => {
  const seen = await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })
  await page.getByLabel('Kundin / Kunde').fill('Bea Wolff')
  await page.getByLabel('Behandlung').fill('Schnitt')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen).toHaveLength(1)
  expect(seen[0].method).toBe('POST')
  expect(seen[0].body).toMatchObject({
    kind: 'appointment',
    date: TODAY,
    startsAt: '06:00',
    endsAt: '06:15',
    customer: 'Bea Wolff',
    treatment: 'Schnitt',
  })
})

test('a change sends the version it was read at', async ({ page }) => {
  // ADR-0003. Without this the stale-save refusal has nothing to compare against.
  const seen = await stub(page, [ANNA], async (route) => {
    await route.fulfill({ status: 200, json: { version: 4 } })
  })
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.getByLabel('Behandlung').fill('Farbe und Schnitt')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen[0].method).toBe('PATCH')
  expect(seen[0].body).toMatchObject({ version: 3, treatment: 'Farbe und Schnitt' })
})

test('a clash keeps the form open with the reason, so the time can be changed', async ({ page }) => {
  await stub(page, [ANNA], async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: 'Diese Zeit ist bei dieser Person schon belegt.', code: 'clash' },
    })
  })
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('schon belegt')
  // The typing survives, because the day underneath has not moved - only this save was refused.
  await expect(page.getByLabel('Kundin / Kunde')).toHaveValue('Anna Schmidt')
})

test('a stale save closes the form and says the day moved on', async ({ page }) => {
  // ADR-0003's own answer, chosen over keeping the typing: reload and look. The distinction is
  // made on the code, not on the German sentence, so improving the wording cannot break it.
  await stub(page, [ANNA], async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: 'Der Eintrag wurde inzwischen geändert. Bitte den Tag neu laden.', code: 'stale' },
    })
  })
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('inzwischen geändert')
})

test('deleting asks first', async ({ page }) => {
  const seen = await stub(page, [ANNA], async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.getByRole('button', { name: 'Löschen' }).click()

  // Nothing has been sent yet. There is no undo, so the confirmation is the whole guard.
  expect(seen).toHaveLength(0)
  await expect(page.getByText('Wirklich löschen?')).toBeVisible()

  // The question and its two answers are the only controls while it is asked. With Abbrechen
  // and Speichern still there the row was wider than the dialogue and Speichern fell off the
  // edge - and there is only one decision to make at this moment anyway.
  await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toHaveCount(0)

  // And the destructive answer is not in the corner where Speichern sits on every other view of
  // this dialogue, because a hand that has learned that corner would land on the one action
  // with no undo.
  const nein = await page.getByRole('button', { name: 'Nein' }).boundingBox()
  const ja = await page.getByRole('button', { name: 'Ja, löschen' }).boundingBox()
  expect(nein!.x).toBeGreaterThan(ja!.x)

  await page.getByRole('button', { name: 'Nein' }).click()
  expect(seen).toHaveLength(0)

  await page.getByRole('button', { name: 'Löschen' }).click()
  await page.getByRole('button', { name: 'Ja, löschen' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen).toHaveLength(1)
  expect(seen[0].method).toBe('DELETE')
  expect(seen[0].url).toContain('version=3')
})

test('a block opens with its times and no customer fields', async ({ page }) => {
  await stub(page, [BLOCK])
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Gesperrt/ }).click()

  await expect(page.getByLabel(/Sperrzeit/)).toBeChecked()
  await expect(page.getByLabel('Von')).toHaveValue('12:00')
  await expect(page.getByLabel('Kundin / Kunde')).toHaveCount(0)
})

test('a block with a reason says it on the box instead of Gesperrt', async ({ page }) => {
  // ADR-0014: the reason replaces the word, because one nobody can see without clicking is worth
  // less than the word it replaced. The tooltip still says gesperrt, and so does the button's
  // accessible name - the hatching is the only other signal, and a screen reader cannot see it.
  await stub(page, [HOLIDAY])
  await page.goto(`/?date=${TODAY}`)

  const box = page.locator('.entry[data-entry-id="b2"]')
  await expect(box).toContainText('Urlaub')
  await expect(box).not.toContainText('Gesperrt')
  await expect(box).toHaveAttribute('title', '14:00–15:00 gesperrt: Urlaub')
})

test('a block with no reason still says Gesperrt', async ({ page }) => {
  await stub(page, [BLOCK])
  await page.goto(`/?date=${TODAY}`)

  await expect(page.locator('.entry[data-entry-id="b1"]')).toContainText('Gesperrt')
})

test('the reason is editable in the form, and only for a block', async ({ page }) => {
  const seen = await stub(page, [HOLIDAY], async (route) => {
    await route.fulfill({ status: 200, json: { version: 2 } })
  })
  await page.goto(`/?date=${TODAY}`)

  await page.locator('.entry[data-entry-id="b2"]').click()
  await expect(page.getByLabel('Grund')).toHaveValue('Urlaub')
  // A block has none of the appointment fields, which is ADR-0008 and unchanged.
  await expect(page.getByLabel('Kundin / Kunde')).toHaveCount(0)
  await expect(page.getByLabel('Notizen')).toHaveCount(0)

  await page.getByLabel('Grund').fill('Fortbildung')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen[0].method).toBe('PATCH')
  expect(seen[0].body).toMatchObject({ kind: 'block', reason: 'Fortbildung', customer: null, version: 1 })
})

test('an appointment has no Grund field to fill in', async ({ page }) => {
  await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await expect(page.getByLabel('Grund')).toHaveCount(0)
  await expect(page.getByLabel('Notizen')).toHaveValue('Reagiert auf Ammoniak')
})

test('ticking Sperrzeit takes the customer fields away', async ({ page }) => {
  await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })
  await expect(page.getByLabel('Kundin / Kunde')).toBeVisible()

  await page.getByLabel(/Sperrzeit/).check()
  await expect(page.getByLabel('Kundin / Kunde')).toHaveCount(0)
  await expect(page.getByLabel('Notizen')).toHaveCount(0)
})

test('the column checkbox blocks a whole day as one 06:00-20:00 row', async ({ page }) => {
  const seen = await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  // click, not check: the box reflects what the server holds, so it only ticks once the day
  // comes back with the block in it. That is the honest behaviour - it shows the data, not the
  // gesture - and it means `.check()` would assert a state change that has not happened yet.
  await page.getByRole('checkbox', { name: /Ganzen Tag für Marco/ }).click()

  expect(seen).toHaveLength(1)
  expect(seen[0].method).toBe('POST')
  expect(seen[0].body).toMatchObject({ kind: 'block', startsAt: '06:00', endsAt: '20:00', employeeId: MARCO })
})

test('the column checkbox says why it was refused on a day with bookings', async ({ page }) => {
  await stub(page, [ANNA], async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: 'Diese Zeit ist bei dieser Person schon belegt.', code: 'clash' },
    })
  })
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('checkbox', { name: /Ganzen Tag für Marco/ }).click()

  await expect(page.getByRole('alert')).toContainText('schon belegt')
})

test('refusing to save what the server would refuse anyway', async ({ page }) => {
  // The same function the server uses, so the common mistakes cost no round trip. The server
  // checks again regardless: a rule enforced only in the browser is not enforced.
  const seen = await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })
  await page.getByLabel('Kundin / Kunde').fill('Bea')
  await page.getByLabel('Bis').fill('06:00')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('alert')).toContainText('Ende muss nach dem Beginn')
  expect(seen).toHaveLength(0)
})

test('an appointment with no name is refused before it is sent', async ({ page }) => {
  const seen = await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('alert')).toContainText('Ohne Namen')
  expect(seen).toHaveLength(0)
})

test('escape and the backdrop both close the form without saving', async ({ page }) => {
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.locator('.modal__backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect(seen).toHaveLength(0)
})

test('a day arriving under the form does not take the save with it', async ({ page }) => {
  // The form saves to the day it was opened on. Reading the loaded day at save time meant Back -
  // or a two-finger swipe - moved the open appointment to the previous day: not stale, not a
  // clash, so nothing on the server refuses it, and the form never showed a date to give it away.
  const seen = await stubDays(page)
  await page.goto(`/?date=${YESTERDAY}`)

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await page.getByRole('button', { name: /Anna Schmidt/ }).click()

  await page.goBack()
  // The form is still open over a board that has moved to another day. That is the situation.
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()

  await page.getByRole('button', { name: 'Speichern' }).click()

  expect(seen).toHaveLength(1)
  expect(seen[0].method).toBe('PATCH')
  expect(seen[0].body).toMatchObject({ date: TODAY, version: 3 })
})

test('the board takes no clicks while the next day is on its way', async ({ page }) => {
  // The dimmed board used to be live. A whole-day tick then landed on the day that was leaving,
  // the arriving day showed the box unticked, and the second tick blocked that day too.
  const seen = await stubDays(page, 2)
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.locator('.shell__fading')).toBeVisible()

  // page.mouse, not click(): clicking through the API waits for the element to be hittable, which
  // is the very thing under test.
  const box = (await page.getByRole('checkbox', { name: /Ganzen Tag für Marco/ }).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  const column = (await page.locator('.board__column').first().boundingBox())!
  await page.mouse.click(column.x + 40, column.y + 8)

  expect(seen).toHaveLength(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the board takes no keys either while the next day is on its way', async ({ page }) => {
  // `pointer-events: none` closed the mouse door and left the keyboard one open: a review pass
  // tabbed into the dimmed board during a load, pressed Space on a column checkbox, and blocked
  // the whole day that was leaving - the exact bug the dimming was added to stop. `inert` closes
  // both, and the invariant it buys is that nothing in there can hold focus at all.
  //
  // Asserted by trying to focus the checkbox outright rather than by counting Tab presses: the tab
  // order runs through the top bar and the day strips, so a fixed number of Tabs proves whatever
  // the layout happens to be that week. The first version of this test passed with `inert` removed.
  const seen = await stubDays(page, 2)
  await page.goto(`/?date=${TODAY}`)

  const wholeDay = page.getByRole('checkbox', { name: /Ganzen Tag für Marco/ })
  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.locator('.shell__fading')).toBeVisible()

  await wholeDay.evaluate((box: HTMLElement) => {
    box.focus()
  })
  const focusInside = await page.evaluate(() => document.activeElement?.closest('.shell__fading') !== null)
  expect(focusInside).toBe(false)

  await page.keyboard.press('Space')
  await page.keyboard.press('Enter')
  expect(seen).toHaveLength(0)
})

test('the keyboard lands where a stray key does no harm', async ({ page }) => {
  // Two defects deep, this one. Focus was the Sperrzeit box, first in DOM order and the one control
  // that destroys data - one Space turned a booking into an unlabelled block. Skipping checkboxes
  // then handed the keyboard the Person select, where on Windows and Linux one ArrowDown silently
  // reassigns the stylist. So it is the customer field now: a stray key types a character somebody
  // can see and delete, and it is where the hand is going anyway.
  await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await expect(page.getByLabel('Kundin / Kunde')).toBeFocused()
  await expect(page.getByLabel(/Sperrzeit/)).not.toBeFocused()
  await expect(page.getByLabel('Person')).not.toBeFocused()

  // Space, the ordinary key for scrolling a page, and the backdrop scrolls.
  await page.keyboard.press('Space')

  await expect(page.getByLabel(/Sperrzeit/)).not.toBeChecked()
  // One visible character in a text field, rather than a booking becoming a grey block.
  await expect(page.getByLabel('Kundin / Kunde')).toHaveValue('Anna Schmidt ')
  await expect(page.getByLabel('Notizen')).toHaveValue('Reagiert auf Ammoniak')
})

test('a Sperrzeit has no customer field, so the dialogue itself takes focus', async ({ page }) => {
  // The fallback, and the reason the dialogue is focusable at all: nothing inside a block form can
  // be pressed into changing what is about to be saved.
  await stub(page, [BLOCK])
  await page.goto(`/?date=${TODAY}`)

  await page.getByRole('button', { name: /Gesperrt/ }).click()

  await expect(page.getByRole('dialog')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByLabel(/Sperrzeit/)).toBeChecked()
  await expect(page.getByLabel('Von')).toHaveValue('12:00')
})

test('typing a name offers what has been typed before', async ({ page }) => {
  await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })
  await page.getByLabel('Kundin / Kunde').fill('An')

  // A datalist is native, so its options are in the DOM rather than on screen.
  await expect(page.locator('datalist option').first()).toHaveAttribute('value', 'Anna Schmidt')
})
