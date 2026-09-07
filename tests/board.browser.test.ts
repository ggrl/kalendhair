import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// The board in a real browser. The API is stubbed rather than reached: this proves what the
// screen does with a day, and the database rules are already proved against a real Postgres
// in the *.db.test.ts files. It also means these run with no database, in the CI job that
// already exists.

const MARCO = '11111111-1111-1111-1111-111111111111'
const JANA = '22222222-2222-2222-2222-222222222222'
const SVEN = '33333333-3333-3333-3333-333333333333'
const TODAY = '2026-08-12'

function dayFor(date: string): Day {
  const entries: Day['entries'] =
    date === '2026-08-13'
      ? [
          {
            id: 'a1',
            version: 1,
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '09:00',
            endsAt: '10:00',
            customer: 'Anna Schmidt',
            treatment: 'Farbe',
            notes: 'Reagiert auf Ammoniak',
            reason: null,
            colour: '#f4b8b8',
          },
          {
            id: 'a2',
            version: 1,
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '10:00',
            endsAt: '10:45',
            customer: 'Bea Wolff',
            treatment: 'Schnitt',
            notes: null,
            reason: null,
            colour: '#f8cfa0',
          },
          {
            id: 'a3',
            version: 1,
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '10:45',
            endsAt: '11:30',
            customer: 'anna schmidt',
            treatment: 'Schnitt und Styling',
            notes: null,
            reason: null,
            colour: '#f4b8b8',
          },
          {
            id: 'a4',
            version: 1,
            employeeId: JANA,
            kind: 'appointment',
            startsAt: '14:00',
            endsAt: '14:15',
            customer: 'Felix Rau',
            treatment: 'Bart',
            notes: null,
            reason: null,
            colour: '#c3aef0',
          },
          {
            // A second appointment carrying notes, so "only one note open at a time" has
            // something to be tested against.
            id: 'a5',
            version: 1,
            employeeId: JANA,
            kind: 'appointment',
            startsAt: '09:00',
            endsAt: '10:30',
            customer: 'Eva Sommer',
            treatment: 'Strähnen',
            notes: 'Kommt mit Kinderwagen',
            reason: null,
            colour: '#c2e6a8',
          },
          {
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
          },
        ]
      : []

  const employees = [
    { id: MARCO, name: 'Marco' },
    { id: JANA, name: 'Jana' },
  ]

  // One date where a third stylist exists. The staff list is the same on every day in reality,
  // so this is not a day-to-day difference - it stands in for the list changing under an open
  // board, which is what the settings screen and the poll can do between two days.
  if (date === '2026-08-18') employees.push({ id: SVEN, name: 'Sven' })

  // And one where nobody is active at all, which draws no grid: the state the landing has to
  // survive being stepped through.
  if (date === '2026-08-20') employees.length = 0

  return {
    date,
    today: TODAY,
    coreHours: date in CORE_HOURS ? CORE_HOURS[date] : { from: '09:00', to: '18:00' },
    employees,
    entries,
  }
}

/**
 * What the server says the core hours are, per date. ADR-0018: the board draws this and computes
 * nothing, so these are the whole truth about where the shading goes.
 *
 * Thursday is deliberately **not** the 09:00-18:00 the old constant held. A board that quietly
 * fell back to a hardcoded week would still pass a test that asked for the values that constant
 * had, which is the one way this test could look green and prove nothing.
 */
const CORE_HOURS: Record<string, { from: string; to: string } | null> = {
  '2026-08-13': { from: '10:00', to: '17:00' },
  '2026-08-15': { from: '08:00', to: '13:30' },
  '2026-08-16': null,
  // An opening on an ODD quarter-hour slot: 09:15 is slot 13 counting from 06:00. The alternating
  // row shading has to stay on the clock rather than on the opening time, and every other fixture
  // here opens on an even slot, where a board that anchored the pattern to the band would look
  // right. This is the only date that can tell the two apart.
  '2026-08-21': { from: '09:15', to: '17:00' },
}

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/day*', async (route) => {
    const requested = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    await route.fulfill({ json: dayFor(requested) })
  })
}

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('draws a column per employee and the hour scale', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  await expect(page.getByText('Marco', { exact: true })).toBeVisible()
  await expect(page.getByText('Jana', { exact: true })).toBeVisible()
  await expect(page.getByText('06:00', { exact: true })).toBeVisible()
  await expect(page.getByText('20:00', { exact: true })).toBeVisible()
})

test('shows the date and the calendar week', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  await expect(page.getByText('KW 33')).toBeVisible()
})

test('shows KW 53 on 1 January 2027, where the week-year is not the year', async ({ page }) => {
  // ADR-0010's bug, on the screen rather than in a unit test. The salon reaches this date
  // about four months after the decision was written.
  await page.goto('/?date=2027-01-01')

  await expect(page.getByRole('heading', { name: 'Freitag, 1. Januar 2027' })).toBeVisible()
  await expect(page.getByText('KW 53')).toBeVisible()
})

test('a box shows the time, the customer and the treatment', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  const box = page.getByRole('button', { name: /Anna Schmidt/ }).first()
  await expect(box).toContainText('09:00–10:00')
  await expect(box).toContainText('Anna Schmidt')
  await expect(box).toContainText('Farbe')
})

test('one customer split across the day gets one colour, the customer between them another', async ({ page }) => {
  // The dye case: colour sets while somebody else is cut. Same colour means same person, so
  // this is the property the whole colour rule exists for.
  await page.goto('/?date=2026-08-13')

  const colourOf = async (text: string): Promise<string> => {
    const box = page.locator('.entry--appointment', { hasText: text }).first()
    return box.evaluate((element) => window.getComputedStyle(element).backgroundColor)
  }

  const first = await colourOf('09:00–10:00')
  const second = await colourOf('10:45–11:30')
  const between = await colourOf('Bea Wolff')

  expect(first).toBe(second)
  expect(between).not.toBe(first)
})

test('notes are not on the board, they are in the form the box opens', async ({ page }) => {
  // Click used to peek at the notes. It opens the editor now, and the notes are a field in it -
  // one gesture with one meaning, and no note panel covering the appointment underneath.
  await page.goto('/?date=2026-08-13')

  await expect(page.getByText('Reagiert auf Ammoniak')).toHaveCount(0)

  await page.getByRole('button', { name: /Anna Schmidt/ }).first().click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Notizen')).toHaveValue('Reagiert auf Ammoniak')
})

test('the shortest bookable box still shows who it is for', async ({ page }) => {
  // A 15-minute box is one line tall. The stacked layout pushed the name out of sight, so
  // the board showed a time and nothing else - an appointment present and unreadable. Found
  // by looking at the rendered board, which is why this test exists at all.
  await page.goto('/?date=2026-08-13')

  const short = page.locator('.entry--appointment', { hasText: 'Felix Rau' })
  await expect(short).toBeVisible()
  await expect(short).toContainText('Felix Rau')
  await expect(short).toContainText('14:00')
})

test('every box says how long it lasts', async ({ page }) => {
  // The stylists asked for it: reading a length off the grid means counting quarter-hour lines or
  // subtracting one time from another, and the box can do both.
  await page.goto('/?date=2026-08-13')

  const durationOf = async (text: string): Promise<string | null> =>
    page.locator('.entry', { hasText: text }).first().locator('.entry__duration').textContent()

  expect(await durationOf('Anna Schmidt')).toBe('1h')
  expect(await durationOf('Bea Wolff')).toBe('45m')
  expect(await durationOf('Eva Sommer')).toBe('1h30')
  // A 15-minute box is one line tall, so the duration rides the line - but it still sits on the
  // right, where it is on every other box. `11:00 Tobi     15m •`, not `11:00 15m Tobi`.
  expect(await durationOf('Felix Rau')).toBe('15m')
  const short = page.locator('.entry', { hasText: 'Felix Rau' }).first()
  const line = (await short.locator('.entry__line').boundingBox())!
  const meta = (await short.locator('.entry__meta').boundingBox())!
  const name = (await short.locator('.entry__customer').boundingBox())!
  expect(meta.x).toBeGreaterThan(name.x + name.width - 1)
  expect(meta.x + meta.width).toBeGreaterThanOrEqual(line.x + line.width - 2)
  // Blocks too, which was the owner's call against my recommendation.
  expect(await page.locator('.entry--block').first().locator('.entry__duration').textContent()).toBe('1h')
})

test('a long name on a short box never pushes the duration off it', async ({ page }) => {
  // Measured while writing this, and worth knowing before touching the line: a long name does NOT
  // get an ellipsis here. `.board__scroller` is `width: max-content`, so the column grows to fit
  // the name and the board scrolls sideways instead - ADR-0021 choosing scrolling over squeezing.
  // The ellipsis rules on `.entry__line .entry__customer` are from an earlier layout and this
  // arrangement cannot reach them.
  //
  // So what is pinned here is the thing that can still go wrong: however wide the name makes the
  // box, the duration stays inside it and to the right of the name.
  //
  // Its own day and its own stub: no fixture has a fifteen-minute box with a name long enough.
  await page.route('**/api/day*', async (route) => {
    await route.fulfill({
      json: {
        date: '2026-08-19',
        today: TODAY,
        coreHours: { from: '09:00', to: '18:00' },
        employees: [{ id: MARCO, name: 'Marco' }, { id: JANA, name: 'Jana' }],
        entries: [
          {
            id: 'long',
            version: 1,
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '11:00',
            endsAt: '11:15',
            customer: 'Katharina Bergmann-Schweitzer',
            treatment: 'Pony',
            notes: 'x',
            reason: null,
            colour: '#f4b8b8',
          },
        ],
      },
    })
  })

  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto('/?date=2026-08-19')
  await page.waitForSelector('.board__grid')

  const box = page.locator('.entry').first()
  const outline = (await box.boundingBox())!
  const name = (await box.locator('.entry__customer').boundingBox())!
  const meta = (await box.locator('.entry__meta').boundingBox())!

  // After the name, and still inside the box that grew to hold it.
  expect(name.x + name.width).toBeLessThanOrEqual(meta.x + 1)
  expect(meta.x + meta.width).toBeLessThanOrEqual(outline.x + outline.width)
  // Whole, not half a number: the box is what gives way, never the duration.
  await expect(box.locator('.entry__duration')).toHaveText('15m')
  // The `scrollWidth > clientWidth` check that used to sit here could not fail - a review pass
  // pointed out that `.entry__meta--line` is `flex: 0 0 auto` around inline text and can never be
  // its own scrollport. This measures the thing that can: the drawn width against what the text
  // needs, which catches the corner being squeezed by anything, flex or not.
  //
  // The duration's own span, not `.entry__meta`: the corner also holds the screen-reader word,
  // which is absolutely positioned, so a range over the whole corner measures a union of two boxes
  // that are nowhere near each other. Measured while writing this - it read 48px needed against
  // 22px drawn on a corner that is drawn perfectly.
  const room = await box.locator('.entry__duration').evaluate((span) => {
    const range = document.createRange()
    range.selectNodeContents(span)
    return { drawn: span.getBoundingClientRect().width, needed: range.getBoundingClientRect().width }
  })
  expect(room.drawn).toBeGreaterThanOrEqual(room.needed - 0.5)
})

test('a note is a folded corner on the board and still a word to a screen reader', async ({ page }) => {
  // The word `Notiz` was the widest thing in the corner and it is what the duration replaced. It
  // survives out of sight, because a shape says nothing to a screen reader and it is the only
  // signal a blind user gets that a note exists - the note's text is deliberately not on the board
  // at all, after a tooltip once showed an allergy to whoever stood at the desk.
  //
  // The dot that replaced the word lasted one session: 10px of punctuation on a coloured box read
  // as a speck of dirt rather than as a clue.
  await page.goto('/?date=2026-08-13')

  const withNote = page.locator('.entry', { hasText: 'Anna Schmidt' }).first()
  const withoutNote = page.locator('.entry', { hasText: 'Bea Wolff' }).first()

  await expect(withNote.locator('.entry__fold')).toHaveCount(1)
  await expect(withoutNote.locator('.entry__fold')).toHaveCount(0)

  // Gone from sight - measured, not asserted with `toBeHidden`, which passes a clipped element
  // this size: it has a bounding box, so Playwright calls it visible. One pixel, clipped, is what
  // a person does not see.
  const word = withNote.locator('.visually-hidden')
  await expect(word).toHaveText('Notiz')
  const occupied = await word.boundingBox()
  // Not null: `display: none` would hide it from the accessible name too, which is the one way of
  // hiding this word that defeats its entire purpose.
  expect(occupied).not.toBeNull()
  expect(occupied!.width).toBeLessThanOrEqual(1)
  expect(occupied!.height).toBeLessThanOrEqual(1)

  // And still in the name the button announces.
  const spoken = await withNote.evaluate((box) => box.textContent ?? '')
  expect(spoken).toContain('Notiz')
  const quiet = await withoutNote.evaluate((box) => box.textContent ?? '')
  expect(quiet).not.toContain('Notiz')

  // The shape adds nothing to that name and must not: "Dreieck" is not a thing anybody needs read
  // out, and the word above is already carrying the meaning.
  await expect(withNote.locator('.entry__fold')).toHaveAttribute('aria-hidden', 'true')
})

test('the folded corner is 15px in the box own bottom-right corner', async ({ page }) => {
  // The owner's size, chosen by looking at it: big enough to read on a 15-minute box, and it clips
  // the tail of that box's `15m` - a trade they made deliberately and with the screenshot in front
  // of them.
  //
  // Anchored to its own box, which is the mistake the old marker made: absolutely positioned
  // against `.board__grid` instead, a marker for the first column landed on the last one.
  await page.goto('/?date=2026-08-13')

  const withNote = page.locator('.entry', { hasText: 'Anna Schmidt' }).first()
  const outline = (await withNote.boundingBox())!
  const fold = (await withNote.locator('.entry__fold').boundingBox())!

  expect(Math.round(fold.width)).toBe(15)
  expect(Math.round(fold.height)).toBe(15)

  // Hard into the bottom-right corner, within a pixel of both edges.
  expect(Math.abs(fold.x + fold.width - (outline.x + outline.width))).toBeLessThanOrEqual(1)
  expect(Math.abs(fold.y + fold.height - (outline.y + outline.height))).toBeLessThanOrEqual(1)
})

test('the corner sits on its own box, not somewhere else on the board', async ({ page }) => {
  // It used to anchor to .board__grid, so a marker for the first column appeared over the
  // last one. Asserted as containment rather than pixels. The corner now carries the duration
  // as well as the note dot, and the same anchoring has to hold for both.
  await page.goto('/?date=2026-08-13')

  const withNotes = page.getByRole('button', { name: /Anna Schmidt/ }).first()
  const box = await withNotes.boundingBox()
  const marker = await withNotes.locator('.entry__meta').boundingBox()

  expect(box).not.toBeNull()
  expect(marker).not.toBeNull()
  expect(marker!.x).toBeGreaterThanOrEqual(box!.x)
  expect(marker!.x + marker!.width).toBeLessThanOrEqual(box!.x + box!.width + 1)
  expect(marker!.y).toBeGreaterThanOrEqual(box!.y)
})

test('a block says so and carries no customer', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  // Exact, because the column headings now also say "ganzer Tag gesperrt".
  await expect(page.getByText('N/A', { exact: true })).toBeVisible()
  // It is a button now, because clicking one opens its times and a way to remove it. ADR-0008
  // gives a block no label, so that is all the form has to hold.
  await expect(page.getByRole('button', { name: /gesperrt/ })).toHaveCount(1)
})

test('the day steps move one day and put it in the address bar', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-14')

  await page.getByRole('button', { name: 'Vorheriger Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-13')
})

test('the week steps keep the weekday', async ({ page }) => {
  // Four clicks for "the same slot in four weeks", landing on a Thursday every time.
  await page.goto('/?date=2026-08-13')

  for (const expected of ['20. August 2026', '27. August 2026', '3. September 2026', '10. September 2026']) {
    await page.getByRole('button', { name: 'Nächste Woche' }).click()
    await expect(page.getByRole('heading', { name: `Donnerstag, ${expected}` })).toBeVisible()
  }

  await expect(page.getByText('KW 37')).toBeVisible()
})

test('a refresh returns to the day on screen, not to today', async ({ page }) => {
  // The reason the date is in the URL at all.
  await page.goto('/?date=2026-08-13')
  await page.getByRole('button', { name: 'Nächste Woche' }).click()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 20. August 2026' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 20. August 2026' })).toBeVisible()
})

test('back returns to the previous day', async ({ page }) => {
  await page.goto('/?date=2026-08-13')
  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
})

test('today is one click away, and stays clickable once you are there', async ({ page }) => {
  // It used to disable itself when the shown day matched the day the server called today at
  // the last load. A board left open past midnight then insisted yesterday was today, with
  // the one control that could fix it switched off. It is never disabled now; the header says
  // which day this is instead.
  await page.goto('/?date=2026-09-24')
  const today = page.getByRole('button', { name: 'Heute' })

  await expect(page.getByText('KW 39')).toBeVisible()
  await expect(page.getByText('· heute')).toHaveCount(0)

  await today.click()

  await expect(page.getByRole('heading', { name: 'Mittwoch, 12. August 2026' })).toBeVisible()
  await expect(page.getByText('· heute')).toBeVisible()
  await expect(today).toBeEnabled()
})

test('with no date in the address bar the server decides the day', async ({ page }) => {
  // The browser must never decide what today is: the machine's clock is whatever the
  // person's laptop says, and the salon's timezone is configuration on the server.
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Mittwoch, 12. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe(TODAY)
})

test('an empty day says so instead of showing a bare grid', async ({ page }) => {
  await page.route('**/api/day*', async (route) => {
    await route.fulfill({ json: { date: '2026-08-13', today: TODAY, employees: [], entries: [] } })
  })
  await page.goto('/?date=2026-08-13')

  await expect(page.getByText('Für diesen Tag ist niemand eingeteilt.')).toBeVisible()
})

test('notes are not revealed by hovering', async ({ page }) => {
  // The tooltip carried the notes, so resting a pointer on a box showed an allergy note to
  // anyone standing at the desk. Three review passes found it independently. Asserted on the
  // attribute, because the visibility assertion above passed the whole time it was broken.
  await page.goto('/?date=2026-08-13')

  const title = await page.getByRole('button', { name: /Anna Schmidt/ }).first().getAttribute('title')

  expect(title).toContain('Anna Schmidt')
  expect(title).not.toContain('Reagiert auf Ammoniak')
})

test('impatient clicking does not swallow day steps or bury the back button', async ({ page }) => {
  // Measured under 700 ms of latency during review: three quick clicks produced two requests
  // and three identical history entries, so the board moved one day and Back appeared dead.
  // The steps were computed from the loaded day instead of the requested one.
  const requested: string[] = []
  await page.route('**/api/day*', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    requested.push(date)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.fulfill({ json: dayFor(date) })
  })

  await page.goto('/?date=2026-08-13')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  const next = page.getByRole('button', { name: 'Nächster Tag' })
  await next.click()
  await next.click()
  await next.click()

  await expect(page.getByRole('heading', { name: 'Sonntag, 16. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-16')
  expect(requested).toContain('2026-08-16')

  // One press of Back moves the board, rather than undoing a duplicate history entry.
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Samstag, 15. August 2026' })).toBeVisible()
})

test('a failed day change keeps saying which day is on screen', async ({ page }) => {
  // The worst finding of the UX pass: the header showed the loaded day while the URL held the
  // requested one, so a failed step left somebody reading today's board believing it was
  // tomorrow - and saying so on the phone.
  await page.goto('/?date=2026-08-13')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  await page.route('**/api/day*', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'internal error' } })
  })
  await page.getByRole('button', { name: 'Nächster Tag' }).click()

  const alert = page.getByRole('alert')
  // German dates in German prose: a receptionist reads 14.08., not 2026-08-14.
  await expect(alert).toContainText('14.08.2026 konnte nicht geladen werden')
  await expect(alert).toContainText('Angezeigt wird weiterhin 13.08.2026')
  await expect(alert.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()

  // Header, board and address bar all agree on the day actually being shown.
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-13')
})

test('a successful retry leaves the address bar on the day now shown', async ({ page }) => {
  // The test above stopped one click short of the defect. After a failed step the URL is put back
  // to the day still showing; a successful retry then loaded the new day and left the URL behind,
  // silently, with no banner - so the next refresh or copied link landed on the wrong day.
  await page.goto('/?date=2026-08-13')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  let fail = true
  await page.route('**/api/day*', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    if (fail) {
      fail = false
      await route.fulfill({ status: 500, json: { error: 'internal error' } })
      return
    }
    await route.fulfill({ json: dayFor(date) })
  })

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByRole('alert')).toContainText('konnte nicht geladen werden')
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-13')

  await page.getByRole('button', { name: 'Erneut versuchen' }).click()

  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-14')

  // And the promise the URL exists for: a reload returns to the day on screen.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
})

test('clicking the same step again after a failure retries instead of doing nothing', async ({ page }) => {
  // Keying the fetch on the date alone made this inert: the target equalled the value already
  // held, React bailed out, and the click pushed a history entry while fetching nothing.
  await page.goto('/?date=2026-08-13')
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  const asked: string[] = []
  let fail = true
  await page.route('**/api/day*', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    asked.push(date)
    if (fail) {
      fail = false
      await route.fulfill({ status: 500, json: { error: 'internal error' } })
      return
    }
    await route.fulfill({ json: dayFor(date) })
  })

  const next = page.getByRole('button', { name: 'Nächster Tag' })
  await next.click()
  await expect(page.getByRole('alert')).toBeVisible()

  await next.click()
  await expect(page.getByRole('heading', { name: 'Freitag, 14. August 2026' })).toBeVisible()
  expect(asked.filter((date) => date === '2026-08-14')).toHaveLength(2)
})

test('the board says when it was last loaded', async ({ page }) => {
  // Nothing polls yet, so a board loaded at 09:00 looks exactly like a live one at 14:00 - which
  // is the failure the brief says the salon already has with photographs.
  await page.goto('/?date=2026-08-13')

  await expect(page.getByText(/Stand \d{2}:\d{2}/)).toBeVisible()
})

test('a failed load says so rather than showing an empty day', async ({ page }) => {
  // An empty board and a broken request must never look the same. One of them is a lie.
  await page.route('**/api/day*', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'internal error' } })
  })
  await page.goto('/?date=2026-08-13')

  await expect(page.getByRole('alert')).toContainText('Laden fehlgeschlagen')
})

test('an entry whose column is missing is reported, not dropped', async ({ page }) => {
  // The last line of defence, and until now the only part of the board with no test at all.
  //
  // ADR-0012 makes the server the thing that keeps entries and columns in step, and it does that
  // in two queries with no transaction: a deactivation committed between them returns an entry
  // whose employee is no longer in the list. That is rare and it is not impossible, and the one
  // outcome that must never happen is the appointment quietly not being drawn.
  await page.route('**/api/day*', async (route) => {
    await route.fulfill({
      json: {
        date: '2026-08-13',
        today: '2026-08-13',
        // Hand-built rather than taken from `dayFor`, so every field the board needs has to be
        // spelled out here. Leaving `coreHours` off blanks the whole board rather than losing the
        // shading - see the note in the pull request; the type is what stops that happening for
        // real, and nothing else does.
        coreHours: null,
        employees: [{ id: MARCO, name: 'Marco' }],
        entries: [
          {
            id: 'orphan',
            version: 1,
            employeeId: '99999999-9999-9999-9999-999999999999',
            kind: 'appointment',
            startsAt: '09:00',
            endsAt: '10:00',
            customer: 'Ida Bruns',
            treatment: 'Balayage',
            notes: null,
            reason: null,
            colour: '#f4b8b8',
          },
        ],
      },
    })
  })
  await page.goto('/?date=2026-08-13')

  const report = page.getByRole('alert')
  await expect(report).toContainText('1 Termin kann nicht angezeigt werden')
  await expect(report).toContainText('Ida Bruns')
  await expect(report).toContainText('keine Spalte')
})

test('the board shades the hours the server says the salon does not work', async ({ page }) => {
  // ADR-0015 for what the shading means, ADR-0018 for where it comes from: the server sends the
  // hours and the board draws them. Shading only - the bookable window is still 06:00-20:00 and
  // nothing here refuses a booking.
  //
  // The stub says 10:00 to 17:00 for this Thursday, which is **not** what the deleted constant
  // said. A board that had kept its own copy of the week would draw 09:00 to 18:00 here and fail.
  await page.goto('/?date=2026-08-13')

  const bands = page.locator('.board__closed')
  await expect(bands).toHaveCount(2)

  // Rows are 1-based in CSS grid, so 06:00 to 10:00 is rows 1 to 16 and 17:00 to 20:00 is 45 to 56.
  await expect(bands.first()).toHaveCSS('grid-row-start', '1')
  await expect(bands.first()).toHaveCSS('grid-row-end', 'span 16')
  await expect(bands.last()).toHaveCSS('grid-row-start', '45')
  await expect(bands.last()).toHaveCSS('grid-row-end', 'span 12')
})

test('a half-hour edge lands on the grid, and a closed day is shaded all day', async ({ page }) => {
  // 13:30 is the one core hour that is not on the hour, and null is how the server says a day is
  // shut - which it answers for Sunday, for Monday and for a public holiday alike, so this is the
  // board's whole behaviour for all three.
  await page.goto('/?date=2026-08-15')
  const saturday = page.locator('.board__closed')
  await expect(saturday).toHaveCount(2)
  // 08:00 is row 9, and 13:30 is row 31 - a half hour that still lands on the quarter-hour grid.
  await expect(saturday.first()).toHaveCSS('grid-row-end', 'span 8')
  await expect(saturday.last()).toHaveCSS('grid-row-start', '31')

  await page.goto('/?date=2026-08-16')
  const sunday = page.locator('.board__closed')
  await expect(sunday).toHaveCount(1)
  await expect(sunday.first()).toHaveCSS('grid-row-start', '1')
  await expect(sunday.first()).toHaveCSS('grid-row-end', 'span 56')
})

test('the top bar does not move while a day is loading', async ({ page }) => {
  // Reported by the salon on 2026-09-07: the add button "disappears for a split second" on every
  // day change and every box move. It was being unmounted for the length of the load - the guard
  // that stops it booking onto the day just left was written as `onAdd: null`, and removing a
  // control from a row of five reflows the other four sideways and back.
  //
  // The guard itself is asserted in `phone.browser.test.ts`; this asserts the thing that was seen.
  await page.goto('/?date=2026-08-13')
  await expect(page.locator('.board__grid')).toBeVisible()

  const boxes = async (): Promise<string> =>
    page.evaluate(() =>
      ['.topbar__icon', '.topbar__today', '.topbar__icon--add']
        .map((selector) => {
          const element = document.querySelector(selector)
          if (element === null) return `${selector}:ABSENT`
          const rect = element.getBoundingClientRect()
          return `${selector}:${Math.round(rect.x)},${Math.round(rect.width)}`
        })
        .join(' '),
    )

  const atRest = await boxes()

  let release = (): void => {}
  await page.route('**/api/day*', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fallback()
  })

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.locator('.shell__loading')).toBeVisible()

  // Every control in the row in the same place, to the pixel, while the day is in flight.
  expect(await boxes()).toBe(atRest)

  release()
  await expect(page.locator('.shell__loading')).toHaveCount(0)
  expect(await boxes()).toBe(atRest)
})

test('the hour rule is thicker than the quarter rule, and painted over it', async ({ page }) => {
  // The stylists asked for a thicker line on every full hour. Two lists have to agree for that to
  // happen: the gradients in `styles.css` and the sizes `Board.tsx` hands them, in the same order.
  // Swapping one list without the other sizes the hour rule to a quarter row, which draws a 2px
  // rule every fifteen minutes - so the ORDER is asserted here and not only the widths.
  await page.goto('/?date=2026-08-13')

  const column = page.locator('.board__column').first()
  const image = await column.evaluate((element) => getComputedStyle(element).backgroundImage)

  // `--rule-hour` at 2px and `--rule-quarter` at 1px, hour first: the first image in the list is
  // the one painted on top. Underneath the quarter rule it lost its top pixel to it and measured
  // 97 ink against the 138 it has now.
  expect(image).toContain('rgb(184, 181, 173) 2px')
  expect(image).toContain('rgb(226, 224, 218) 1px')
  expect(image.indexOf('rgb(184, 181, 173)')).toBeLessThan(image.indexOf('rgb(226, 224, 218)'))

  // An hour, then a quarter - the same order as the gradients above.
  await expect(column).toHaveCSS('background-size', '100% 70px, 100% 17.5px')
})

test('an hour of grid is a whole number of pixels, so every hour rule draws the same', async ({ page }) => {
  // This is why the stylists saw thick lines at only some hours. At 1.1rem a row is 17.6px and an
  // hour 70.4px, so a rule at 70.4 x n mostly straddles two pixels at part strength: measured on
  // this board, the fourteen hour rules ranged from 30 ink to 61, and the weakest was 1.11x a
  // quarter rule. At 17.5px all fourteen measure 138, which is 5.11x a quarter rule.
  //
  // Asserted as arithmetic rather than by reading pixels, because the arithmetic IS the property:
  // an hour has to be a whole number of pixels. Putting 1.1rem back fails this line.
  await page.goto('/?date=2026-08-13')

  // Measured from the grid's own box rather than parsed out of `grid-template-rows`, whose
  // serialisation could become `repeat(56, 17.5px)` and hand this test a NaN instead of a failure
  // anybody could read.
  const row = await page
    .locator('.board__grid')
    .evaluate((element) => element.getBoundingClientRect().height / 56)

  expect(row).toBe(17.5)
  expect(Number.isInteger(row * 4)).toBe(true)
})

test('the working hours get alternating rows, and no other part of the day does', async ({ page }) => {
  // The stylists asked for this after using the board: crossing six columns without losing the
  // line you are on. Inside the working hours only - outside them the grey wash already says
  // something, and striping that too would be two greys arguing about the same rows.
  await page.goto('/?date=2026-08-13')

  const rows = page.locator('.board__rows')
  await expect(rows).toHaveCount(1)
  // 10:00 is row 17 and 17:00 is row 45, so the stripes fill 28 rows and stop exactly where the
  // first grey band ended - the two are computed from the same two numbers for that reason.
  await expect(rows).toHaveCSS('grid-row-start', '17')
  await expect(rows).toHaveCSS('grid-row-end', 'span 28')
  // One tile is two rows: the first left alone, the second shaded.
  await expect(rows).toHaveCSS('background-size', '100% 35px')

  // **And that it is actually shaded.** Everything above is the geometry of an element that is
  // allowed to be invisible: `--row-shade: transparent`, or `background-image: none`, passed every
  // one of those assertions and deleted the feature the salon asked for. `background-size` still
  // computes to `100% 35px` with no image at all, which is what made that hole so quiet.
  await expect(rows).toHaveCSS('background-image', /rgba\(55, 54, 54, 0\.04\)/)

  // A day the salon does not work has no white part for stripes to alternate against, so there is
  // nothing to draw. Sunday, Monday and a public holiday all arrive as null.
  await page.goto('/?date=2026-08-16')
  await expect(page.locator('.board__rows')).toHaveCount(0)
})

test('a shaded row stays lighter than a closed hour, which is the whole point of it', async ({ page }) => {
  // The salon's own condition: the alternating grey has to be lighter than the grey over the hours
  // they do not work, so that "working" and "not working" stay a glance apart. Both are the same
  // ink at different alphas, so comparing the alphas IS the ordering.
  //
  // Asserted because the inversion was green: `--row-shade` at 20%, darker than the 10% wash and
  // the exact thing the comment in `styles.css` calls the one thing this must not do, passed all
  // 163 browser tests. Nothing was looking at the colour.
  await page.goto('/?date=2026-08-13')

  const alphaOf = (value: string): number => {
    const match = /rgba?\(\s*55,\s*54,\s*54(?:,\s*([\d.]+))?\s*\)/.exec(value)
    if (match === null) throw new Error(`not the board's grey ink: ${value}`)
    return match[1] === undefined ? 1 : Number(match[1])
  }

  const shade = alphaOf(
    await page.locator('.board__rows').evaluate((element) => getComputedStyle(element).backgroundImage),
  )
  const wash = alphaOf(
    await page.locator('.board__closed').first().evaluate((element) => getComputedStyle(element).backgroundColor),
  )

  expect(shade).toBeLessThan(wash)
  // And neither of them invisible, which `transparent` would satisfy the line above with.
  expect(shade).toBeGreaterThan(0)
})

test('the alternating rows follow the clock, not the opening time', async ({ page }) => {
  // 09:15 is an odd slot. The tile starts at the band, so without a shift the band's own first row
  // would be the shaded one, and this day would read 09:15 shaded where every other day reads
  // 09:15 white - the pattern half a step out, differing by weekday for no reason a stylist could
  // see. Remove the shift in `Board.tsx` and this fails.
  await page.goto('/?date=2026-08-21')

  const odd = page.locator('.board__rows')
  await expect(odd).toHaveCSS('grid-row-start', '14')
  await expect(odd).toHaveCSS('background-position-y', '17.5px')

  // And an even opening needs no shift, which is the other half of the same claim.
  await page.goto('/?date=2026-08-13')
  await expect(page.locator('.board__rows')).toHaveCSS('background-position-y', '0%')
})

test('the alternating rows take no clicks either', async ({ page }) => {
  // The same trap as the shading, in a worse place. This overlay covers the working hours, which
  // is where nearly every appointment gets made, so if it swallowed a pointer the board would
  // stop taking bookings during opening hours and keep taking them at 06:00 - and the test above
  // books at 06:00.
  await page.goto('/?date=2026-08-13')

  // Positioned inside the column element rather than from viewport coordinates, exactly as the
  // 06:00 case below does it: the board has already scrolled itself to the opening hour, so the
  // grid's own box is off screen and viewport arithmetic clicks the top bar.
  //
  // 37 rows down is 15:15: inside the working hours, one of the shaded ones, and free - Marco is
  // booked solidly from 09:00 to 11:30 on this date, so a click in the morning lands on a box and
  // proves nothing about the overlay.
  //
  // The row height is measured rather than written down. Hardcoding it means that changing the row
  // height again fails this test with "Von is 15:00, expected 15:15", which says nothing about what
  // actually broke.
  const row = await page
    .locator('.board__grid')
    .evaluate((element) => element.getBoundingClientRect().height / 56)
  await page.locator('.board__column').first().click({ position: { x: 40, y: row * 37 + 8 } })

  await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toBeVisible()
  await expect(page.getByLabel('Von')).toHaveValue('15:15')
})

test('the shading takes no clicks, so closed hours still book', async ({ page }) => {
  // The salon books outside its core hours and the paper page always allowed it. If the shading
  // swallowed a click it would have quietly become a rule.
  await page.goto('/?date=2026-08-16')

  await page.locator('.board__column').first().click({ position: { x: 40, y: 8 } })

  await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toBeVisible()
  await expect(page.getByLabel('Von')).toHaveValue('06:00')
})

// The holiday shading used to be asserted here and is not any more. ADR-0018 moved the decision
// to the server, so with a stubbed `/api/day` this file can only ever assert what the stub was
// told to say - a test that looks like it proves the Hessen list and proves the fixture instead.
// It is asserted in `tests/hours.db.test.ts` against the real thing, and the half that is still
// the board's job - null means shade the whole day - is the Sunday case above.

test('the top bar names the holiday, so the pink board is not a riddle', async ({ page }) => {
  // ADR-0016. Without the name, a board washed from 06:00 to 20:00 is ambiguous between "the
  // salon is shut" and "something is broken" - which is the shape of problem this project exists
  // to remove, not to add.
  await page.goto('/?date=2026-04-03')

  await expect(page.getByRole('heading', { name: 'Freitag, 3. April 2026' })).toBeVisible()
  await expect(page.locator('.topbar__week')).toContainText('Karfreitag')
  await expect(page.locator('.topbar__week')).toContainText('KW 14')

  // And an ordinary day says nothing extra.
  await page.goto('/?date=2026-04-02')
  await expect(page.locator('.topbar__holiday')).toHaveCount(0)
})

test('the board opens at 08:00, clear of the column headings', async ({ page }) => {
  // The bookable day starts at 06:00 and the salon rarely works before 08:00, so the board used
  // to open on two empty hours. Clear of the headings is the half that is easy to get wrong: the
  // headings are sticky and opaque, so scrolling 08:00 to the very top of the pane would tuck the
  // line under them and land somewhere that looks like 09:00.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const scrolled = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  expect(scrolled).toBeGreaterThan(0)

  const eight = (await page.getByText('08:00', { exact: true }).boundingBox())!
  const heads = (await page.locator('.board__heads').boundingBox())!
  const pane = (await page.locator('.shell__day').boundingBox())!

  expect(eight.y).toBeGreaterThanOrEqual(heads.y + heads.height)
  expect(eight.y + eight.height).toBeLessThanOrEqual(pane.y + pane.height)

  // And 06:00 is above the fold rather than gone: it is still bookable, ADR-0015 shades it and
  // refuses nothing, so this is a starting position and not a shorter day.
  const six = (await page.getByText('06:00', { exact: true }).boundingBox())!
  expect(six.y).toBeLessThan(pane.y)
})

test('stepping a day keeps the position, so an afternoon is not sent back to the morning', async ({ page }) => {
  // The landing is for opening the board, not for every navigation. Somebody checking the same
  // slot across a week steps days repeatedly, and having the board jump under them each time is
  // the behaviour this deliberately does not have.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const landed = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  // Read back rather than assumed: 700 is past the bottom of a 56-row board on this viewport, and
  // the browser silently clamps it. Asserting the number that was written would have compared the
  // position against one the pane never held.
  const moved = await page.locator('.shell__day').evaluate((pane) => {
    pane.scrollTop = 700
    return pane.scrollTop
  })
  // Or a board that reset to 08:00 on every step would pass this test.
  expect(moved).not.toBe(landed)

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  const after = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  expect(after).toBe(moved)
})

test('a day with nobody on it does not cost the next day its landing', async ({ page }) => {
  // A review pass walked this: staffed day, empty day, staffed day, and arrived back at 06:00.
  // The grid unmounts when there is nobody to draw, which resets the pane's scroll - but the flag
  // saying the landing had happened survived, so the board never scrolled again.
  await page.goto('/?date=2026-08-19')
  await page.waitForSelector('.board__grid')
  const first = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  expect(first).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByText('Für diesen Tag ist niemand eingeteilt.')).toBeVisible()

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await page.waitForSelector('.board__grid')

  const again = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  expect(again).toBe(first)
})

test('a stylist appearing does not send the board back to 08:00 either', async ({ page }) => {
  // The landing happens once and stays happened. It is written as an effect that re-runs when the
  // column count changes - a day with nobody on it draws no grid, so the first day loaded can have
  // nothing to scroll - and without the guard beside it, a staff list changing under an open board
  // would jump a reader back to the morning. ADR-0019 is the same principle for the poll: data
  // arriving is not a navigation.
  await page.goto('/?date=2026-08-17')
  await page.waitForSelector('.board__grid')

  const moved = await page.locator('.shell__day').evaluate((pane) => {
    pane.scrollTop = 700
    return pane.scrollTop
  })

  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByText('Sven', { exact: true })).toBeVisible()

  const after = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  expect(after).toBe(moved)
})

test('the word buttons have round ends, like the icons beside them', async ({ page }) => {
  // `Heute` sits between two circles, and a square-cornered button between them read as an odd one
  // out. The week steps follow it so the top bar is one set of shapes.
  //
  // Half the height or more is the test, not a particular number: that is the point at which a
  // browser draws semicircular ends, and it stays true if the padding or the font size moves.
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const shapes = await page
    .locator('.topbar__today, .topbar__step')
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        label: button.textContent?.trim() ?? '',
        radius: parseFloat(window.getComputedStyle(button).borderTopLeftRadius),
        height: button.getBoundingClientRect().height,
      })),
    )

  expect(shapes).toHaveLength(3)
  for (const shape of shapes) {
    expect(shape.height).toBeGreaterThan(0)
    expect(shape.radius, shape.label).toBeGreaterThanOrEqual(shape.height / 2)
  }
})

test('the action row reads settings, today, add - and the icons are named', async ({ page }) => {
  // The order is deliberate: the day you are on in the middle, and the two ways of leaving it
  // either side. An icon has no text to be named by, so both carry an `aria-label` - a control a
  // screen reader announces only as "Schaltfläche" is one nobody can use.
  await stubApi(page)
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const names = await page
    .locator('.topbar__actions button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()))
  expect(names).toEqual(['Einstellungen', 'Heute', 'Neuer Termin'])

  // Round, and actually round: equal width and height, or the border-radius draws an oval.
  const shape = await page.locator('.topbar__icon').first().evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height) }
  })
  expect(shape.width).toBe(shape.height)
})

test('every control is on the top row and the date is underneath', async ({ page }) => {
  // The owner's arrangement: one row of controls - week back, settings, Heute, add, week forward -
  // and below it only what day it is.
  await stubApi(page)
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const actions = (await page.locator('.topbar__actions').boundingBox())!
  const date = (await page.locator('.topbar__date').boundingBox())!
  const prev = (await page.locator('.topbar__step').first().boundingBox())!
  const next = (await page.locator('.topbar__step').nth(1).boundingBox())!

  expect(actions.y + actions.height).toBeLessThanOrEqual(date.y)

  // The week steps share that row rather than flanking the date. Compared by centre, because the
  // buttons are not the same height as the icons beside them and never were.
  const middleOf = (box: { y: number; height: number }): number => box.y + box.height / 2
  expect(Math.abs(middleOf(prev) - middleOf(actions))).toBeLessThan(4)
  expect(Math.abs(middleOf(next) - middleOf(actions))).toBeLessThan(4)
  expect(prev.y + prev.height).toBeLessThanOrEqual(date.y)
  expect(next.y + next.height).toBeLessThanOrEqual(date.y)

  // Left, middle, right - and the date centred under all three.
  expect(prev.x).toBeLessThan(actions.x)
  expect(next.x).toBeGreaterThan(actions.x + actions.width)

  // And the eye and the keyboard read the same order. A grid can put a row on top while the markup
  // leaves it last, and then Tab reaches the week steps and the date picker before the row above
  // them - the half of this change a screenshot cannot show.
  //
  // Document order, and then the real thing below it. This comment used to say a real Tab could
  // not be asserted here because the board's own 08:00 scroll moved the browser's focus starting
  // point - true at the time, and written off as ordinary browser behaviour. It was a regression
  // in the same session, a review pass measured what it cost, and `Board.tsx` no longer does it.
  const markupOrder = await page.evaluate(() =>
    [...document.querySelectorAll('.topbar__step, .topbar__actions, .topbar__date')].map(
      (element) => element.className,
    ),
  )
  expect(markupOrder).toEqual(['topbar__step', 'topbar__actions', 'topbar__step', 'topbar__date'])
})

test('the first Tab after a load lands in the top bar, not inside the board', async ({ page }) => {
  // The blocker a review pass found. The board scrolls itself to 08:00 on load, and the first
  // version did that with `scrollIntoView`, which sets the browser's sequential focus navigation
  // starting point to the element it scrolls to - the hour scale, deep inside the grid. So the
  // first Tab landed on an appointment and the second on the next-day strip: Tab, Enter opened a
  // customer's form, and the entire top bar could not be reached by tabbing forward at all.
  //
  // Three presses rather than one, because the failure was not "the wrong element" but "everything
  // before the board is gone".
  await stubApi(page)
  await page.goto('/?date=2026-08-13')
  await page.waitForSelector('.board__grid')

  const reached: string[] = []
  for (let press = 0; press < 3; press += 1) {
    await page.keyboard.press('Tab')
    reached.push(
      await page.evaluate(() => {
        const active = document.activeElement
        return active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? ''
      }),
    )
  }

  expect(reached).toEqual(['Vorige Woche', 'Einstellungen', 'Heute'])

  // And the landing still happened - the fix is not "stop scrolling".
  const scrolled = await page.locator('.shell__day').evaluate((pane) => pane.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
})

test('the hour scale takes what the times need and gives the rest to the columns', async ({ page }) => {
  // Narrowed from 4rem to 2.5rem once the day-step buttons lost their boxes. Asserted as slack
  // rather than as a number of pixels: the point is that "06:00" fits with room to spare, which is
  // what a system font a fraction wider than this one would eat first.
  await stubApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const scale = await page.evaluate(() => {
    const label = document.querySelector('.board__hour') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(label)
    const style = window.getComputedStyle(label)
    const heads = window.getComputedStyle(document.querySelector('.board__heads')!).gridTemplateColumns
    const grid = window.getComputedStyle(document.querySelector('.board__grid')!).gridTemplateColumns
    return {
      cell: Math.round(label.getBoundingClientRect().width),
      text: range.getBoundingClientRect().width,
      room: label.clientWidth - parseFloat(style.paddingRight),
      // One line, not two: too narrow and the label wraps instead of clipping.
      lines: Math.round(label.getBoundingClientRect().height / parseFloat(style.fontSize)),
      firstColumnOfHeads: heads.split(' ')[0],
      firstColumnOfGrid: grid.split(' ')[0],
    }
  })

  expect(scale.cell).toBe(40)
  expect(scale.text).toBeLessThan(scale.room)
  expect(scale.lines).toBe(1)
  // The pair that must never disagree: sizing the two grids apart is what once put every heading
  // over the wrong stylist, and this is the column they share.
  expect(scale.firstColumnOfHeads).toBe(scale.firstColumnOfGrid)
})

test('a narrow screen keeps the week steps on the row and drops their words, not their names', async ({ page }) => {
  // Five controls do not fit one row at 390px. The words go and the chevrons stay - and the thing
  // being defended is not the look: the row overflowing made the whole PAGE scroll sideways, which
  // ADR-0021 gives to the board alone.
  await stubApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  await expect(page.locator('.topbar__step-words').first()).toBeVisible()

  await page.setViewportSize({ width: 390, height: 700 })
  await expect(page.locator('.topbar__step-words').first()).toBeHidden()

  const narrow = await page.evaluate(() => {
    const bar = document.querySelector('.topbar')!
    return {
      barOverflows: bar.scrollWidth > bar.clientWidth,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  expect(narrow.barOverflows).toBe(false)
  expect(narrow.pageScrollsSideways).toBe(false)

  // The name does not change with the width of the glass. Hiding the words without this would
  // leave a button announcing itself as "«", which is not a thing anybody can act on.
  await expect(page.getByRole('button', { name: 'Vorige Woche', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nächste Woche', exact: true })).toBeVisible()

  // And it still steps a week, with no words on it.
  await page.getByRole('button', { name: 'Nächste Woche', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mittwoch, 19. August 2026' })).toBeVisible()
})
