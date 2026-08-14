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

test('the notes marker sits on its own box, not somewhere else on the board', async ({ page }) => {
  // It used to anchor to .board__grid, so a marker for the first column appeared over the
  // last one. Asserted as containment rather than pixels.
  await page.goto('/?date=2026-08-13')

  const withNotes = page.getByRole('button', { name: /Anna Schmidt/ }).first()
  const box = await withNotes.boundingBox()
  const marker = await withNotes.locator('.entry__notes-marker').boundingBox()

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
