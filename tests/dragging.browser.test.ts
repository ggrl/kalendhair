import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'
import { SLOT_COUNT, slotFromWallClock } from '../src/calendar/grid.js'

// The gestures, in a real browser against a stubbed API. What is proved here is what a drag sends
// and what it refuses to send; that the server refuses the same things again is proved against a
// real Postgres in write.db.test.ts, and that is the rule that counts.

// Tall enough to hold all 56 rows at once. There is deliberately no autoscroll while dragging, so
// a gesture only exists between two points that are both on screen - on a laptop that means
// scrolling to the part of the day you are working on first, exactly as these tests do by fitting
// the whole board. `Desktop Chrome`'s 720px would put the afternoon below the fold and the release
// would land outside the window.
test.use({ viewport: { width: 1280, height: 1200 } })

const MARCO = '11111111-1111-1111-1111-111111111111'
const JANA = '22222222-2222-2222-2222-222222222222'
const TODAY = '2026-08-13'
const YESTERDAY = '2026-08-12'

interface Recorded {
  method: string
  url: string
  body: unknown
}

interface Point {
  x: number
  y: number
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

/** Marco's second booking, left where a dragged Anna can be made to land on it. */
const BEA: Day['entries'][number] = {
  id: 'a2',
  version: 1,
  employeeId: MARCO,
  kind: 'appointment',
  startsAt: '11:00',
  endsAt: '12:00',
  customer: 'Bea Wolff',
  treatment: 'Schnitt',
  notes: null,
  reason: null,
  colour: '#f8cfa0',
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
  reason: 'Urlaub',
  colour: null,
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

async function stub(
  page: Page,
  entries: Day['entries'],
  writeReply?: (route: Route) => Promise<void>,
  /** Makes this numbered day request onwards slow, which is the window the board spends dimmed. */
  slowFrom = Number.POSITIVE_INFINITY,
): Promise<Recorded[]> {
  const seen: Recorded[] = []
  let asks = 0

  await page.route('**/api/suggestions*', async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.route('**/api/day*', async (route) => {
    // Answers whichever date is asked for. Anna and the others exist on TODAY only, so a test can
    // step to another day and see an empty board.
    asks += 1
    if (asks >= slowFrom) await new Promise((resolve) => setTimeout(resolve, 1500))
    const asked = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    await route.fulfill({ json: { ...dayWith(asked === TODAY ? entries : []), date: asked } })
  })

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
    await route.fulfill({ status: 200, json: { version: 4 } })
  })

  return seen
}

/** The centre of the row that holds a wall clock time, in the column belonging to one employee. */
async function at(page: Page, column: number, wallClock: string): Promise<Point> {
  const grid = await page.locator('.board__grid').boundingBox()
  const cell = await page.locator('.board__column').nth(column).boundingBox()
  if (grid === null || cell === null) throw new Error('the board is not on screen')

  const row = grid.height / SLOT_COUNT
  return { x: cell.x + cell.width / 2, y: grid.y + row * (slotFromWallClock(wallClock) + 0.5) }
}

/** How tall one 15-minute row is on screen, and where a row line sits. */
async function rowHeight(page: Page): Promise<number> {
  const grid = await page.locator('.board__grid').boundingBox()
  if (grid === null) throw new Error('the board is not on screen')
  return grid.height / SLOT_COUNT
}

async function rowLine(page: Page, wallClock: string): Promise<number> {
  const grid = await page.locator('.board__grid').boundingBox()
  if (grid === null) throw new Error('the board is not on screen')
  return grid.y + (await rowHeight(page)) * slotFromWallClock(wallClock)
}

/** The middle of a box, which is the part that moves it rather than resizing it. */
async function bodyOf(page: Page, id: string): Promise<Point> {
  const box = await page.locator(`.entry[data-entry-id="${id}"]`).boundingBox()
  if (box === null) throw new Error(`no box for ${id}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function dragFromTo(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // More than one step: without a pointermove between down and up there is no gesture to track,
  // which would make every one of these tests pass for the wrong reason.
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

/**
 * Waits for the writes a gesture caused, because a release only starts a `fetch`.
 *
 * Asserting on the recorder directly passes or fails on whether the request happened to have been
 * intercepted yet - which is how a test that proves nothing looks exactly like one that passes.
 */
async function writes(seen: Recorded[], count: number): Promise<void> {
  await expect.poll(() => seen.length, { timeout: 2000 }).toBe(count)
}

test('dragging out empty grid proposes that range and writes nothing yet', async ({ page }) => {
  // The drag proposes; the form still has to be filled in. Nothing exists until Speichern.
  const seen = await stub(page, [])
  await page.goto(`/?date=${TODAY}`)

  await dragFromTo(page, await at(page, 0, '14:00'), await at(page, 0, '14:45'))

  await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toBeVisible()
  await expect(page.getByLabel('Von')).toHaveValue('14:00')
  await expect(page.getByLabel('Bis')).toHaveValue('15:00')
  expect(seen).toHaveLength(0)
})

test('a box dragged to another stylist and another time is saved at the version it was read at', async ({ page }) => {
  // ADR-0003: the version travels with the drag, so a box somebody else changed meanwhile is
  // refused rather than overwritten.
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  // Grabbed one row down from the top, and released four hours lower in Jana's column, so the
  // whole box moves four hours and keeps its length.
  await dragFromTo(page, await at(page, 0, '09:15'), await at(page, 1, '13:15'))

  await writes(seen, 1)
  expect(seen[0].method).toBe('PATCH')
  expect(seen[0].body).toMatchObject({
    employeeId: JANA,
    date: TODAY,
    startsAt: '13:00',
    endsAt: '14:00',
    version: 3,
    // A move is a move. Everything the gesture did not touch goes back as it was.
    kind: 'appointment',
    customer: 'Anna Schmidt',
    treatment: 'Farbe',
    notes: 'Reagiert auf Ammoniak',
  })
})

test('a hand that twitches across a row line still opens the form and saves nothing', async ({ page }) => {
  // The threshold is pixels, not rows, and this is why. A row is 17.6px: comparing slots meant a
  // three-pixel twitch across a row line wrote a fifteen-minute change with no dialogue and no
  // undo, from about a third of every box. The test that was supposed to cover this passed only
  // because the box centre it grabbed sat exactly on a row boundary - so these press deliberately
  // beside a line, in both directions.
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  const line = await rowLine(page, '09:30')
  const body = await bodyOf(page, 'a1')

  await dragFromTo(page, { x: body.x, y: line - 2 }, { x: body.x, y: line + 2 })
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()
  await expect(page.getByLabel('Von')).toHaveValue('09:00')
  await page.keyboard.press('Escape')

  await dragFromTo(page, { x: body.x, y: line + 2 }, { x: body.x, y: line - 2 })
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()
  await expect(page.getByLabel('Von')).toHaveValue('09:00')

  expect(seen).toHaveLength(0)
})

test('past the threshold it is a drag, so it does not open the form either', async ({ page }) => {
  // The other side of the threshold, and the only way to see it from outside: a twitch opens the
  // form, while a real drag that happens to land back on the same quarter hour opens nothing and
  // saves nothing. Two thirds of a row is past the threshold and still inside the row it started
  // in, so there is nothing to write.
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  const body = await bodyOf(page, 'a1')
  await dragFromTo(page, body, { x: body.x, y: body.y + (await rowHeight(page)) * 0.6 })

  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen).toHaveLength(0)
})

test('a drag that ends where it started writes nothing and opens nothing', async ({ page }) => {
  // The brief's own awkward case. It travelled, so it is a drag and not a click - and it changed
  // nothing, so there is nothing to save and no form to open.
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  const body = await bodyOf(page, 'a1')
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.mouse.move(body.x, body.y + (await rowHeight(page)) * 4, { steps: 6 })
  await page.mouse.move(body.x, body.y, { steps: 6 })
  await page.mouse.up()

  await expect(page.locator('.entry[data-entry-id="a1"]')).toContainText('09:00')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen).toHaveLength(0)
})

test('a range dragged onto occupied time is refused instead of opening the form', async ({ page }) => {
  // The proposal turns red while the pointer is there, so the release has to agree with it.
  // Opening a form that Speichern would then refuse is exactly what saying it early prevents.
  const seen = await stub(page, [BEA])
  await page.goto(`/?date=${TODAY}`)

  await dragFromTo(page, await at(page, 0, '10:30'), await at(page, 0, '11:30'))

  await expect(page.getByRole('alert')).toContainText('schon belegt')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(seen).toHaveLength(0)
})

test('a day arriving under a held pointer abandons the drag', async ({ page }) => {
  // Verified as a defect first: `popstate` needs no pointer event - a mouse's back side-button, or
  // Alt and Left - and pointer capture keeps the gesture alive through the swap, so the release
  // wrote to a day nobody was looking at. Neither stale nor a clash, so nothing refused it.
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${YESTERDAY}`)
  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.locator('.entry[data-entry-id="a1"]')).toBeVisible()

  const body = await bodyOf(page, 'a1')
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.mouse.move(body.x, body.y + (await rowHeight(page)) * 8, { steps: 8 })
  await page.goBack()
  // The new day has to be on screen before the release, or this test proves the other branch by
  // accident - which is exactly what it did on the first run.
  await expect(page.locator('.entry[data-entry-id="a1"]')).toHaveCount(0)
  await page.mouse.up()

  await expect(page.getByRole('alert')).toContainText('Tag hat sich geändert')
  expect(seen).toHaveLength(0)
})

test('a release during a slow day change still writes to the day it started on', async ({ page }) => {
  // The other branch, and the one the captured date exists for: the board has not arrived yet, so
  // there is nothing to compare against on screen - and the write must still name the day the box
  // was picked up on rather than the day being fetched.
  // The third day request is the slow one: yesterday, today, then the step back. It has to be
  // history rather than the day strip, because a captured pointer means a click on that button
  // never reaches it - which is the capture doing its job.
  const seen = await stub(page, [ANNA], undefined, 3)
  await page.goto(`/?date=${YESTERDAY}`)
  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.locator('.entry[data-entry-id="a1"]')).toBeVisible()

  const body = await bodyOf(page, 'a1')
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.mouse.move(body.x, body.y + (await rowHeight(page)) * 8, { steps: 8 })
  await page.goBack()
  await expect(page.locator('.shell__fading')).toBeVisible()
  await page.mouse.up()

  await writes(seen, 1)
  expect(seen[0].body).toMatchObject({ date: TODAY, startsAt: '11:00', endsAt: '12:00' })
})

test('dragging the bottom edge changes the end and leaves the start alone', async ({ page }) => {
  const seen = await stub(page, [ANNA, BEA])
  await page.goto(`/?date=${TODAY}`)

  const grip = await page.locator('.entry[data-entry-id="a1"] .entry__grip--bottom').boundingBox()
  if (grip === null) throw new Error('no bottom grip')
  await dragFromTo(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, await at(page, 0, '10:45'))

  await writes(seen, 1)
  // Ending exactly where Bea starts is not a clash: the constraint compares half-open ranges, and
  // a 15-minute grid is nothing but adjacent appointments.
  expect(seen[0].body).toMatchObject({ startsAt: '09:00', endsAt: '11:00', version: 3 })
})

test('a drop onto occupied time is refused before it is sent, and the box goes back', async ({ page }) => {
  const seen = await stub(page, [ANNA, BEA])
  await page.goto(`/?date=${TODAY}`)

  // Two hours down lands Anna exactly on top of Bea.
  await dragFromTo(page, await at(page, 0, '09:15'), await at(page, 0, '11:15'))

  await expect(page.getByRole('alert')).toContainText('schon belegt')
  // Sprung back: the box still reads the time it still has.
  await expect(page.locator('.entry[data-entry-id="a1"]')).toContainText('09:00')
  expect(seen).toHaveLength(0)
})

test('a drag below the last row stops at closing time', async ({ page }) => {
  const seen = await stub(page, [ANNA])
  await page.goto(`/?date=${TODAY}`)

  const grid = await page.locator('.board__grid').boundingBox()
  if (grid === null) throw new Error('the board is not on screen')
  const column = await at(page, 0, '09:15')
  await dragFromTo(page, column, { x: column.x, y: grid.y + grid.height + 200 })

  await writes(seen, 1)
  // Clamped, and still an hour long. The cursor being past the end of the board is not a mistake
  // worth a message.
  expect(seen[0].body).toMatchObject({ startsAt: '19:00', endsAt: '20:00' })
})

test('a block drags exactly like an appointment', async ({ page }) => {
  // ADR-0008 puts them in one table under one constraint, so they get one set of gestures.
  const seen = await stub(page, [BLOCK])
  await page.goto(`/?date=${TODAY}`)

  await dragFromTo(page, await at(page, 1, '12:15'), await at(page, 1, '15:15'))

  await writes(seen, 1)
  expect(seen[0].body).toMatchObject({
    kind: 'block',
    employeeId: JANA,
    startsAt: '15:00',
    endsAt: '16:00',
    customer: null,
    treatment: null,
    notes: null,
    // A move is a move: the reason travels with it, or dragging a block would quietly erase why
    // the time was blocked. ADR-0014.
    reason: 'Urlaub',
  })
})
