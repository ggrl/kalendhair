import { devices, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// ADR-0021, at the sizes it is about. What is proved here is that a phone can read the board and
// add an appointment, and that a finger cannot move one - the last of those is the reason this
// change is not simply a stylesheet.

const TODAY = '2026-08-13'

/**
 * An iPhone 13 without `defaultBrowserType`, which Playwright refuses inside a describe group
 * because it would force a new worker. What is wanted here is the viewport and `hasTouch`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13']

/** Six, which is the brief's own awkward case and the number that made columns 55px wide. */
const STAFF = ['Marco', 'Elif', 'Jana', 'Aaron', 'Sabine', 'Tobias'].map((name, index) => ({
  id: `${index + 1}1111111-1111-1111-1111-111111111111`,
  name,
}))

interface Sent {
  method: string
  body: unknown
}

async function stub(
  page: Page,
  employees = STAFF,
  treatment = 'Farbe und Schnitt',
  coreHours: Day['coreHours'] = { from: '09:00', to: '18:00' },
): Promise<Sent[]> {
  const sent: Sent[] = []

  await page.route('**/api/day*', async (route) => {
    const day: Day = {
      date: TODAY,
      today: TODAY,
      coreHours,
      employees,
      entries: employees.length === 0 ? [] : [{
        id: 'a1',
        version: 1,
        employeeId: employees[0].id,
        kind: 'appointment',
        startsAt: '09:00',
        endsAt: '10:00',
        // Long on purpose: this is the name that was cut to `Anna Schmi dt` at 55px.
        customer: 'Alexandra Bergmann',
        treatment,
        notes: null,
        reason: null,
        colour: '#f4b8b8',
      }],
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(day) })
  })

  await page.route('**/api/entries**', async (route) => {
    sent.push({ method: route.request().method(), body: route.request().postDataJSON() })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'new' }) })
  })
  await page.route('**/api/suggestions*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  return sent
}

test.describe('on a phone', () => {
  test.use(IPHONE)

  test('the day pane scrolls sideways instead of squeezing six stylists', async ({ page }) => {
    await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await page.waitForSelector('.board__grid')

    const column = await page.locator('.board__column').first().boundingBox()
    // 55px before this change, and a name was three wrapped lines of which two were cut off.
    expect(column!.width).toBeGreaterThanOrEqual(150)

    const scrolls = await page.evaluate(() => {
      const pane = document.querySelector('.shell__day')!
      return pane.scrollWidth > pane.clientWidth
    })
    expect(scrolls).toBe(true)
  })

  test('every heading sits over its own column, whatever the content is', async ({ page }) => {
    // The defect this whole change exists to fix, reproduced in a worse form by the first attempt
    // at fixing it. `.board__heads` and `.board__grid` are two separate grids; with
    // `width: max-content` a `1fr` track resolves from each grid's *own* largest item, so the
    // headings size from the names and the board sizes from the boxes. They drift apart and every
    // column from the second on is labelled with the previous stylist's name - which states a name
    // confidently and wrongly, where the old board merely cut it up.
    //
    // Long content in both grids, because either one can be the wider.
    const staff = [...STAFF]
    staff[0] = { ...staff[0], name: 'Alexandra Bergmann' }
    await stub(page, staff, 'Waschen, Schneiden, Föhnen')
    await page.goto(`/?date=${TODAY}`)
    await page.waitForSelector('.board__grid')

    const offsets = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.board__head')].map((e) => e.getBoundingClientRect().x)
      const columns = [...document.querySelectorAll('.board__column')].map((e) => e.getBoundingClientRect().x)
      return columns.map((x, index) => Math.round(x - heads[index]))
    })
    expect(offsets, `heading and column left edges drifted apart: ${offsets.join(', ')}`).toEqual(
      offsets.map(() => 0),
    )
  })

  test('a customer name is not cut in half', async ({ page }) => {
    await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await expect(page.getByText('Alexandra Bergmann')).toBeVisible()

    const clipped = await page.locator('.entry').first().evaluate(
      (box) => box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight,
    )
    expect(clipped).toBe(false)
  })

  test('the headings are readable and stay put, rather than hiding behind the top bar', async ({ page }) => {
    // The defect that made the phone board useless: `.topbar` declared a fixed 6.5rem height its
    // wrapped content could not keep, and being z-index 10 with an opaque background it painted
    // over the names at z-index 9. `Marco` rendered as `M` above the buttons and `co` below them.
    await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await page.waitForSelector('.board__heads')

    // Asked of the pixels, not of the boxes. The bar's *box* stayed 104px tall while its content
    // overflowed and painted over the names, so comparing bounding boxes sees nothing wrong - an
    // earlier version of this test passed with the fixed height put back.
    const covering = await page.evaluate(() => {
      const head = document.querySelector('.board__head')!.getBoundingClientRect()
      const on = document.elementFromPoint(head.x + head.width / 2, head.y + head.height / 2)
      return { inHeads: on?.closest('.board__heads') !== null && on?.closest('.board__heads') !== undefined,
               tag: on?.className ?? '(nothing)' }
    })
    expect(covering.inHeads, `something else is painted over the headings: ${covering.tag}`).toBe(true)

    // And they hold their place when the board is scrolled down, which is what they are for.
    await page.evaluate(() => { document.querySelector('.shell__day')!.scrollTop = 500 })
    await page.waitForTimeout(150)
    const pane = (await page.locator('.shell__day').boundingBox())!
    const after = (await page.locator('.board__heads').boundingBox())!
    expect(Math.abs(after.y - pane.y)).toBeLessThan(3)
    await expect(page.getByText('Tobias')).toBeAttached()
  })

  test('the hour scale stays on screen while the board scrolls sideways', async ({ page }) => {
    // A board scrolled away from its own times says which stylist and not when.
    await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await page.waitForSelector('.board__grid')

    await page.evaluate(() => { document.querySelector('.shell__day')!.scrollLeft = 400 })
    await page.waitForTimeout(150)

    const pane = (await page.locator('.shell__day').boundingBox())!
    const hour = (await page.locator('.board__hour').first().boundingBox())!
    expect(Math.abs(hour.x - pane.x)).toBeLessThan(3)
  })

  test('a finger dragged across a booking moves nothing', async ({ page }) => {
    // ADR-0021, and the reason this is not only a stylesheet. A drag commits on release with no
    // undo (ADR-0013), and a swipe to scroll that begins on top of a box would otherwise be one.
    const sent = await stub(page)
    await page.goto(`/?date=${TODAY}`)
    const box = page.locator('.entry').first()
    await expect(box).toBeVisible()

    const bounds = (await box.boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2

    // Real touch through the browser, not `dispatchEvent`. A synthetic pointer event carries a
    // pointerId the browser has never seen, so `setPointerCapture` throws and no gesture starts at
    // all - which made an earlier version of this test pass with the touch rule deleted.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (const step of [30, 70, 120, 170]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    await page.waitForTimeout(400)
    // Nothing written, and the box is still where it was.
    expect(sent.filter((request) => request.method !== 'GET')).toHaveLength(0)
    await expect(page.locator('.entry').first()).toContainText('09:00')
  })

  test('a finger dragged on a board that cannot scroll still moves nothing', async ({ page }) => {
    // A board where nothing can scroll, which is where a swipe has nowhere to go.
    //
    // Measured before this test was written: Chromium sends one `pointermove:touch` and then
    // `pointercancel:touch`, even here. So no touch drag can ever write - and the assertion that
    // matters is the second one, that the cancelled gesture does not announce itself.
    // Tall enough that the whole day fits, keeping the touch capability of this describe block.
    await page.setViewportSize({ width: 390, height: 1400 })

    const sent = await stub(page, [STAFF[0]])
    await page.goto(`/?date=${TODAY}`)
    const box = page.locator('.entry').first()
    await expect(box).toBeVisible()

    const bounds = (await box.boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (const step of [30, 70, 120, 170]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)

    expect(sent.filter((request) => request.method !== 'GET')).toHaveLength(0)
    await expect(page.locator('.entry').first()).toContainText('09:00')

    // And, the part that is actually reachable: no refusal for something nobody tried to do.
    // Chromium cancels a touch drag itself, so the write was never possible - but one pointermove
    // arrives first, which is past the drag threshold, and the cancel then reports a movement that
    // was abandoned. Every swipe over a box would say so.
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('+ Termin opens an empty form and books what is typed into it', async ({ page }) => {
    const sent = await stub(page)
    await page.goto(`/?date=${TODAY}`)

    await page.getByRole('button', { name: '+ Termin' }).click()
    await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toBeVisible()

    await page.getByLabel('Kundin / Kunde').fill('Telefon Kundin')
    await page.getByLabel('Behandlung').fill('Schnitt')
    await page.getByRole('button', { name: 'Speichern' }).click()

    await expect.poll(() => sent.filter((request) => request.method === 'POST').length).toBe(1)
    const body = sent.find((request) => request.method === 'POST')!.body as Record<string, unknown>
    expect(body.customer).toBe('Telefon Kundin')
    expect(body.date).toBe(TODAY)
    expect(body.employeeId).toBe(STAFF[0].id)
  })

  test('+ Termin is not live while a day is on its way', async ({ page }) => {
    // The top bar sits outside the `inert` subtree, which covers the board only. During a day step
    // the header names one day and the board underneath is another - and a review pass clicked
    // this button in that window and booked onto the day it had just left, with the form showing
    // no date at all to say otherwise.
    const sent = await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await expect(page.getByRole('button', { name: '+ Termin' })).toBeVisible()

    let release = () => {}
    await page.route('**/api/day*', async (route) => {
      await new Promise<void>((resolve) => { release = resolve })
      await route.fallback()
    })

    await page.getByRole('button', { name: 'Nächster Tag' }).click()
    await expect(page.locator('.shell__loading')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Termin' })).toHaveCount(0)

    release()
    await expect(page.getByRole('button', { name: '+ Termin' })).toBeVisible()
    expect(sent.filter((request) => request.method === 'POST')).toHaveLength(0)
  })

  test('a new appointment starts at the salon opening hour, not at nine o clock', async ({ page }) => {
    // The comment beside this claimed "the first hour of the salon's day" while the code said
    // 09:00, so a salon opening at 10:00 got a default inside its own shaded closed band.
    await stub(page, STAFF, 'Farbe', { from: '10:00', to: '16:00' })
    await page.goto(`/?date=${TODAY}`)

    await page.getByRole('button', { name: '+ Termin' }).click()
    await expect(page.getByLabel('Von')).toHaveValue('10:00')
    await expect(page.getByLabel('Bis')).toHaveValue('11:00')
  })

  test('the frozen hour scale takes no clicks', async ({ page }) => {
    // It covers whichever column has scrolled under it, and the grid resolves a stylist from the
    // pointer's x - so a tap on the times opened a form for somebody nobody could see.
    await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await page.waitForSelector('.board__grid')
    await page.evaluate(() => { document.querySelector('.shell__day')!.scrollLeft = 300 })
    await page.waitForTimeout(150)

    const scale = (await page.locator('.board__scale').boundingBox())!
    await page.mouse.click(scale.x + scale.width / 2, scale.y + 300)

    await expect(page.getByRole('heading', { name: 'Neuer Eintrag' })).toHaveCount(0)
  })

  test('+ Termin is not offered on a day with nobody on the board', async ({ page }) => {
    // Its first field is the person, and there is nobody to be.
    await stub(page, [])
    await page.goto(`/?date=${TODAY}`)
    await expect(page.getByText('Für diesen Tag ist niemand eingeteilt.')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Termin' })).toHaveCount(0)
  })
})

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('six stylists still share the width, with no sideways scrolling at all', async ({ page }) => {
    // The minimum only bites when there is not enough room. On the screen the salon uses all day
    // nothing about this change may be visible.
    await stub(page)
    await page.goto(`/?date=${TODAY}`)
    await page.waitForSelector('.board__grid')

    const scrolls = await page.evaluate(() => {
      const pane = document.querySelector('.shell__day')!
      return pane.scrollWidth > pane.clientWidth
    })
    expect(scrolls).toBe(false)

    const column = await page.locator('.board__column').first().boundingBox()
    expect(column!.width).toBeGreaterThan(150)
  })

  test('a mouse can still drag a booking', async ({ page }) => {
    // The touch rule must not have taken the desktop gesture with it.
    const sent = await stub(page)
    await page.goto(`/?date=${TODAY}`)
    const box = page.locator('.entry').first()
    await expect(box).toBeVisible()

    const bounds = (await box.boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 60, { steps: 8 })
    await page.mouse.up()

    await expect.poll(() => sent.filter((request) => request.method === 'PATCH').length).toBe(1)
  })
})
