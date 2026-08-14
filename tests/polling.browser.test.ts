import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// ADR-0019, in a real browser against a stubbed API and a controlled clock.
//
// Everything here turns on time passing, so `page.clock` drives it rather than anybody waiting
// thirty real seconds. The stub is the server: what these prove is when the board asks, what it
// does with the answer, and what it says when there is no answer.

// Tall enough to hold all 56 rows, for the same reason the dragging tests are: a gesture only
// exists between two points that are both on screen.
test.use({ viewport: { width: 1280, height: 1200 } })

const MARCO = '11111111-1111-1111-1111-111111111111'
const JANA = '22222222-2222-2222-2222-222222222222'
const TODAY = '2026-08-13'

/** Thirty seconds, and it has to match `POLL_INTERVAL_MS` in `App.tsx`. */
const INTERVAL = 30_000

function appointment(id: string, customer: string, startsAt: string, endsAt: string): Day['entries'][number] {
  return {
    id,
    version: 1,
    employeeId: MARCO,
    kind: 'appointment',
    startsAt,
    endsAt,
    customer,
    treatment: 'Cut',
    notes: null,
    reason: null,
    colour: '#f4b8b8',
  }
}

const ANNA = appointment('a1', 'Anna Schmidt', '09:00', '10:00')
const BERND = appointment('b1', 'Bernd Klein', '11:00', '12:00')

/**
 * The server, as a thing the test can change its mind about between polls.
 *
 * `inFlight` and `mostInFlight` are what prove there is never a second request while one is open -
 * the reason `App.tsx` chains `setTimeout` instead of using `setInterval`.
 */
interface Server {
  requests: string[]
  entries: Day['entries']
  failing: boolean
  /** Answers 401, as an ended session does. A flag rather than a second route, so the day stub is
   *  never unregistered - removing it would let the board keep rendering stale state and make an
   *  assertion about what is on screen mean nothing. */
  unauthorized: boolean
  delayMs: number
  inFlight: number
  mostInFlight: number
}

async function stubDay(page: Page): Promise<Server> {
  const server: Server = {
    requests: [],
    entries: [ANNA],
    failing: false,
    unauthorized: false,
    delayMs: 0,
    inFlight: 0,
    mostInFlight: 0,
  }

  await page.route('**/api/day*', async (route) => {
    server.requests.push(route.request().url())
    server.inFlight += 1
    server.mostInFlight = Math.max(server.mostInFlight, server.inFlight)

    // A real timer in the test process, not the page's faked one, so a slow response stays slow
    // while the board's clock is being run forward.
    if (server.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, server.delayMs))

    server.inFlight -= 1

    if (server.unauthorized) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Bitte anmelden.' }) })
      return
    }

    if (server.failing) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'kaputt' }) })
      return
    }

    // Echoes the day it was asked for, like the real server. A stub that always answered the same
    // date would make the board look like it never navigates, and hide the thing being tested.
    const asked = new URL(route.request().url()).searchParams.get('date') ?? TODAY

    const day: Day = {
      date: asked,
      today: TODAY,
      coreHours: { from: '09:00', to: '18:00' },
      employees: [
        { id: MARCO, name: 'Marco' },
        { id: JANA, name: 'Jana' },
      ],
      entries: server.entries,
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(day) })
  })

  return server
}

/**
 * Opens the board with the clock under the test's control.
 *
 * Installed before `goto`, so the timer the board sets on its first render is a faked one - install
 * it afterwards and the first interval is a real thirty seconds that no `runFor` can reach.
 */
async function openBoard(page: Page): Promise<Server> {
  await page.clock.install()
  const server = await stubDay(page)
  await page.goto(`/?date=${TODAY}`)
  await expect(page.getByText('Anna Schmidt')).toBeVisible()
  return server
}

/** Lets the board's timer fire, then gives the response somewhere to land. */
async function tick(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.clock.runFor(INTERVAL)
  }
}

/**
 * One poll, waited out to the point where the board has had the chance to draw the answer.
 *
 * **Any test asserting that a polled entry is absent has to use this.** `toHaveCount(0)` succeeds
 * the moment it is evaluated, so a board that had simply not received the response yet passes it
 * exactly as well as a board correctly holding the answer back - which is how the deferral tests
 * first passed with the deferral deleted. Waiting for the response and then for a render beat is
 * what makes the absence mean something.
 */
async function pollAndSettle(page: Page): Promise<void> {
  const answered = page.waitForResponse((response) => response.url().includes('/api/day'))
  await page.clock.runFor(INTERVAL)
  await answered
  await page.waitForTimeout(200)
}

/** Pretends the tab went behind something else, or came back. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

test('the board swaps in what arrived, without anybody pressing anything', async ({ page }) => {
  const server = await openBoard(page)
  const first = server.requests.length

  server.entries = [ANNA, BERND]
  await tick(page)

  await expect(page.getByText('Bernd Klein')).toBeVisible()
  expect(server.requests.length).toBeGreaterThan(first)
})

test('a poll never dims the board or takes the keyboard away', async ({ page }) => {
  // The reason a poll is not a load. Dimming and `inert` exist for a navigation somebody asked
  // for; doing either every thirty seconds would make the screen flicker on its own and take the
  // keyboard out of somebody's hands mid-sentence.
  //
  // Watched with an observer rather than asserted after the fact, because a flicker is exactly the
  // thing a check at one moment misses.
  const server = await openBoard(page)

  await page.evaluate(() => {
    const win = window as unknown as { __disturbed: boolean }
    win.__disturbed = false
    new MutationObserver(() => {
      if (document.querySelector('.shell__fading, .shell__loading, [inert]') !== null) {
        win.__disturbed = true
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  })

  server.entries = [ANNA, BERND]
  await tick(page)
  await expect(page.getByText('Bernd Klein')).toBeVisible()

  expect(await page.evaluate(() => (window as unknown as { __disturbed: boolean }).__disturbed)).toBe(false)
})

test('a poll asks for the day on screen, and does not move off it', async ({ page }) => {
  // The brief's rule: updating data must never change which day is on screen.
  const server = await openBoard(page)
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Mittwoch, 12. August 2026' })).toBeVisible()

  const before = server.requests.length
  await tick(page)
  await expect.poll(() => server.requests.length).toBeGreaterThan(before)

  // The day it asked for is the day being shown, not the one the URL started on.
  expect(server.requests[server.requests.length - 1]).toContain('date=2026-08-12')
  await expect(page.getByRole('heading', { name: 'Mittwoch, 12. August 2026' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-08-12')
})

test('nothing moves under a drag, and the newest day lands when it ends', async ({ page }) => {
  // The brief's own awkward case, and the reason the swap is deferred rather than skipped.
  const server = await openBoard(page)

  const box = page.getByRole('button', { name: /Anna Schmidt/ })
  const bounds = (await box.boundingBox())!
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 60, { steps: 6 })

  server.entries = [ANNA, BERND]
  await pollAndSettle(page)

  // The day has arrived and been held: the board still shows what it showed.
  await expect(page.getByText('Bernd Klein')).toHaveCount(0)

  // Back to where it started before releasing, so this gesture writes nothing and reloads nothing.
  // A drag that commits would fetch the day again on save, and that fetch - not the held parcel -
  // would be what put Bernd on the board. The test would pass while proving something else.
  await page.mouse.move(x, y, { steps: 6 })
  const asked = server.requests.length
  await page.mouse.up()

  // Lands the moment the hand comes off, rather than waiting out another interval.
  await expect(page.getByText('Bernd Klein')).toBeVisible()
  expect(server.requests.length).toBe(asked)
})

test('nothing moves under an open form, and the newest day lands when it closes', async ({ page }) => {
  const server = await openBoard(page)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()

  server.entries = [ANNA, BERND]
  await pollAndSettle(page)
  await expect(page.getByText('Bernd Klein')).toHaveCount(0)

  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.getByText('Bernd Klein')).toBeVisible()
})

test('a hidden tab asks for nothing, and asks once the moment it comes back', async ({ page }) => {
  const server = await openBoard(page)
  const before = server.requests.length

  await setHidden(page, true)
  await tick(page, 4)
  // Waited out before asserting nothing happened. Checking the count the instant `runFor` returns
  // passes just as well on a board that has fired four requests which have not been recorded yet -
  // the mutation of polling-while-hidden went undetected until this wait was here.
  await page.waitForTimeout(300)
  expect(server.requests.length).toBe(before)

  await setHidden(page, false)
  await expect.poll(() => server.requests.length).toBe(before + 1)
})

test('a response landing after the tab is hidden does not schedule another poll', async ({ page }) => {
  // The other half of not polling a hidden tab, and the half the test above cannot reach.
  //
  // Hiding the tab clears the pending timer, which is what stops the ordinary case. This is the
  // race underneath it: a request already in flight comes back *after* the tab went away, and the
  // code that schedules the next tick runs then. Without the `document.hidden` check at that
  // moment, a tab hidden for the night keeps polling forever on a chain nothing ever cleared -
  // and the ordinary test passes throughout, because it never has a request in flight.
  const server = await openBoard(page)
  server.delayMs = 800

  const answered = page.waitForResponse((response) => response.url().includes('/api/day'))
  await page.clock.runFor(INTERVAL)
  await setHidden(page, true)
  await answered
  await page.waitForTimeout(200)

  const after = server.requests.length
  await tick(page, 3)
  await page.waitForTimeout(300)
  expect(server.requests.length).toBe(after)
})

test('two failures in a row stop the board claiming to be current, and one success restores it', async ({ page }) => {
  const server = await openBoard(page)
  const stand = page.locator('.topbar__stand')
  await expect(stand).not.toContainText('nicht aktuell')

  server.failing = true
  // Settled, not merely ticked. `not.toContainText` succeeds the moment it is evaluated, so a
  // board about to render the warning passes it exactly as well as one correctly withholding it -
  // which is how a threshold of one first went undetected here.
  await pollAndSettle(page)
  // One blip says nothing: the commonest failure there is, and it recovers on the next tick.
  await expect(stand).not.toContainText('nicht aktuell')

  await pollAndSettle(page)
  await expect(stand).toContainText('nicht aktuell')

  server.failing = false
  await pollAndSettle(page)
  await expect(stand).not.toContainText('nicht aktuell')
})

test('a response slower than the interval never produces two requests at once', async ({ page }) => {
  // Why the next tick is scheduled when the last one finishes rather than on a fixed interval.
  // With `setInterval`, a slow connection stacks requests until one wins a race and the board
  // flickers between two answers.
  const server = await openBoard(page)
  server.delayMs = 1_500

  await tick(page, 3)
  await expect.poll(() => server.inFlight).toBe(0)

  expect(server.mostInFlight).toBe(1)
})

test('a poll that finds an ended session closes the form and stops asking', async ({ page }) => {
  // The logic review's first blocker, and the ADR consequence that was written down and never
  // asserted. A navigation already closed the form on a 401 and carried a comment saying why; the
  // poll is a second door onto the same bug and a worse one, because it interrupts somebody who is
  // typing rather than somebody who pressed a button.
  const server = await openBoard(page)

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await page.getByLabel('Kundin / Kunde').fill('Halb getippter Name')

  server.unauthorized = true
  await pollAndSettle(page)
  await expect(page.getByLabel('Salon-Passwort', { exact: true })).toBeVisible()

  // It stops rather than retrying an ended session every thirty seconds.
  const after = server.requests.length
  await tick(page, 4)
  await page.waitForTimeout(300)
  expect(server.requests.length).toBe(after)

  // **Now log back in**, which is the only place the bug is visible. While `needsLogin` is true the
  // login screen replaces the whole tree, so the dialogue is absent whether or not it was closed -
  // asserting its absence here passes with the fix reverted, and did.
  server.unauthorized = false
  const loads = server.requests.length
  await page.route('**/api/login', async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })
  await page.getByLabel('Salon-Passwort', { exact: true }).fill('egal')
  await page.getByRole('button', { name: 'Anmelden' }).click()

  // A real load after the login, not leftover state: the board asked again and was answered.
  await expect.poll(() => server.requests.length).toBeGreaterThan(loads)
  await expect(page.getByText('Anna Schmidt')).toBeVisible()
  // The form must not come back with its typing gone and a captured date pointing at a day nobody
  // is looking at.
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toHaveCount(0)
})

test('hiding and showing during a request does not open a second one or a second chain', async ({ page }) => {
  // The logic and security passes found this one independently, and both measured it. Without the
  // in-flight guard, `clearTimeout` has nothing to clear while a request is open, so the
  // visibility handler starts a second - and each surviving chain overwrites the single timer
  // variable, orphaning the other. Twenty cycles measured 21 concurrent requests.
  const server = await openBoard(page)
  server.delayMs = 1_200

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.clock.runFor(INTERVAL)
    await page.waitForTimeout(150)
    await setHidden(page, true)
    await setHidden(page, false)
  }

  await expect.poll(() => server.inFlight).toBe(0)
  expect(server.mostInFlight).toBe(1)

  // And exactly one chain survives: one interval must produce one request, not five.
  server.delayMs = 0
  const before = server.requests.length
  await tick(page)
  await page.waitForTimeout(400)
  expect(server.requests.length).toBe(before + 1)
})

test('a day held while the form is open is dropped by a navigation, not applied over newer data', async ({ page }) => {
  // The logic review's second blocker. The parcel was guarded only by its date, and the date is
  // not enough: it survived Back and Forward, and a navigation that re-fetched the same day
  // brought newer data that the older parcel then clobbered on close - with a fresh `Stand`, so
  // the board claimed to be current while showing an entry that had already been removed.
  const server = await openBoard(page)

  // Somewhere to go back to. Opening the board at a URL leaves no history behind it, and Back and
  // Forward are the gesture this is about - a mouse's side button does it, which is how the
  // mid-drag write bug was found two sessions ago.
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Mittwoch, 12. August 2026' })).toBeVisible()
  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()

  await page.getByRole('button', { name: /Anna Schmidt/ }).click()
  await expect(page.getByRole('heading', { name: 'Eintrag bearbeiten' })).toBeVisible()

  // A poll lands and is held, holding the board as it was: Anna alone.
  await pollAndSettle(page)

  // Somebody books Bernd, and a navigation round trip brings him in properly.
  server.entries = [ANNA, BERND]
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Mittwoch, 12. August 2026' })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Donnerstag, 13. August 2026' })).toBeVisible()
  await expect(page.getByText('Bernd Klein')).toBeVisible()

  await page.getByRole('button', { name: 'Abbrechen' }).click()

  // The stale parcel must not put the board back to before Bernd existed.
  await page.waitForTimeout(300)
  await expect(page.getByText('Bernd Klein')).toBeVisible()
})

test('a failed day step does not brand the board stale while the poll keeps working', async ({ page }) => {
  // The logic review's fourth blocker, and it was my own ruling that caused it: folding a failed
  // navigation into the same phrase pinned `nicht aktuell` on until somebody asked for another
  // day, while the poll went on succeeding and moving the timestamp next to it.
  const server = await openBoard(page)
  const stand = page.locator('.topbar__stand')

  server.failing = true
  await page.getByRole('button', { name: 'Nächster Tag' }).click()
  await expect(page.getByRole('alert')).toContainText('konnte nicht geladen werden')

  // The banner says which day failed, in a sentence. The Stand line is about the poll.
  server.failing = false
  server.entries = [ANNA, BERND]
  await pollAndSettle(page)

  await expect(page.getByText('Bernd Klein')).toBeVisible()
  await expect(stand).not.toContainText('nicht aktuell')
})
