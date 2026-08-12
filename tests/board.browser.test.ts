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
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '09:00',
            endsAt: '10:00',
            customer: 'Anna Schmidt',
            treatment: 'Farbe',
            notes: 'Reagiert auf Ammoniak',
            colour: '#f4b8b8',
          },
          {
            id: 'a2',
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '10:00',
            endsAt: '10:45',
            customer: 'Bea Wolff',
            treatment: 'Schnitt',
            notes: null,
            colour: '#f8cfa0',
          },
          {
            id: 'a3',
            employeeId: MARCO,
            kind: 'appointment',
            startsAt: '10:45',
            endsAt: '11:30',
            customer: 'anna schmidt',
            treatment: 'Schnitt und Styling',
            notes: null,
            colour: '#f4b8b8',
          },
          {
            id: 'a4',
            employeeId: JANA,
            kind: 'appointment',
            startsAt: '14:00',
            endsAt: '14:15',
            customer: 'Felix Rau',
            treatment: 'Bart',
            notes: null,
            colour: '#c3aef0',
          },
          {
            // A second appointment carrying notes, so "only one note open at a time" has
            // something to be tested against.
            id: 'a5',
            employeeId: JANA,
            kind: 'appointment',
            startsAt: '09:00',
            endsAt: '10:30',
            customer: 'Eva Sommer',
            treatment: 'Strähnen',
            notes: 'Kommt mit Kinderwagen',
            colour: '#c2e6a8',
          },
          {
            id: 'b1',
            employeeId: JANA,
            kind: 'block',
            startsAt: '12:00',
            endsAt: '13:00',
            customer: null,
            treatment: null,
            notes: null,
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

test('notes stay hidden until the box is clicked', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  const notes = page.getByText('Reagiert auf Ammoniak')
  await expect(notes).toBeHidden()

  await page.getByRole('button', { name: /Anna Schmidt/ }).first().click()
  await expect(notes).toBeVisible()

  await page.getByRole('button', { name: /Anna Schmidt/ }).first().click()
  await expect(notes).toBeHidden()
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

test('a block is grey, says so, and carries no customer', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  const block = page.getByText('Gesperrt')
  await expect(block).toBeVisible()
  // Not a button: there is nothing to open, because a block has no notes and no customer.
  await expect(page.getByRole('button', { name: /Gesperrt/ })).toHaveCount(0)
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

test('escape closes an open note, and only one is open at a time', async ({ page }) => {
  await page.goto('/?date=2026-08-13')

  await page.getByRole('button', { name: /Anna Schmidt/ }).first().click()
  await expect(page.getByText('Reagiert auf Ammoniak')).toBeVisible()

  // A second note replaces the first rather than stacking on top of it.
  await page.getByRole('button', { name: /Eva Sommer/ }).click()
  await expect(page.getByText('Kommt mit Kinderwagen')).toBeVisible()
  await expect(page.getByText('Reagiert auf Ammoniak')).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(page.getByText('Kommt mit Kinderwagen')).toBeHidden()
})

test('a box with nothing to reveal is not pressable', async ({ page }) => {
  // Making every box a button taught the receptionist that clicking does nothing, which is
  // the lesson that makes somebody miss the one box carrying an allergy note.
  await page.goto('/?date=2026-08-13')

  await expect(page.getByRole('button', { name: /Bea Wolff/ })).toHaveCount(0)
  await expect(page.locator('.entry--appointment', { hasText: 'Bea Wolff' })).toBeVisible()
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
  await expect(alert).toContainText('2026-08-14')
  await expect(alert).toContainText('Angezeigt wird weiterhin 2026-08-13')
  await expect(alert.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()

  // Header, board and address bar all agree on the day actually being shown.
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-13')
})

test('a failed load says so rather than showing an empty day', async ({ page }) => {
  // An empty board and a broken request must never look the same. One of them is a lie.
  await page.route('**/api/day*', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'internal error' } })
  })
  await page.goto('/?date=2026-08-13')

  await expect(page.getByRole('alert')).toContainText('Laden fehlgeschlagen')
})
