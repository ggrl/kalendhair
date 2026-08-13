import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// The board in a real browser. The API is stubbed rather than reached: this proves what the
// screen does with a day, and the database rules are already proved against a real Postgres
// in the *.db.test.ts files. It also means these run with no database, in the CI job that
// already exists.

const MARCO = '11111111-1111-1111-1111-111111111111'
const JANA = '22222222-2222-2222-2222-222222222222'
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

  return {
    date,
    today: TODAY,
    employees: [
      { id: MARCO, name: 'Marco' },
      { id: JANA, name: 'Jana' },
    ],
    entries,
  }
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
  await expect(page.getByText('Gesperrt', { exact: true })).toBeVisible()
  // It is a button now, because clicking one opens its times and a way to remove it. ADR-0008
  // gives a block no label, so that is all the form has to hold.
  await expect(page.getByRole('button', { name: /Gesperrt/ })).toHaveCount(1)
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

test('the board shades the hours the salon does not normally work', async ({ page }) => {
  // ADR-0015, and shading only: the bookable window is still 06:00-20:00 and nothing here refuses
  // a booking. 2026-08-13 is a Thursday, so the white part runs 09:00 to 18:00.
  await page.goto('/?date=2026-08-13')

  const bands = page.locator('.board__closed')
  await expect(bands).toHaveCount(2)

  // Rows are 1-based in CSS grid, so 06:00 to 09:00 is rows 1 to 12 and 18:00 to 20:00 is 49 to 56.
  await expect(bands.first()).toHaveCSS('grid-row-start', '1')
  await expect(bands.first()).toHaveCSS('grid-row-end', 'span 12')
  await expect(bands.last()).toHaveCSS('grid-row-start', '49')
  await expect(bands.last()).toHaveCSS('grid-row-end', 'span 8')
})

test('a Saturday closes at half past one, and a Sunday is shaded all day', async ({ page }) => {
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
