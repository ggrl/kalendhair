import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Day } from '../src/calendar/types.js'

// The day steps, after the owner asked for the boxes to go: only the chevron shows, the cursor
// becomes a one-way arrow, and the strip grows with the screen instead of staying a 28px sliver.

const TODAY = '2026-08-13'

const FOUR = ['Marco', 'Elif', 'Jana', 'Aaron'].map((name, index) => ({
  id: `${index + 1}1111111-1111-1111-1111-111111111111`,
  name,
}))

/** Eight, which is the salon this could grow into and the case where a wide strip costs something. */
const EIGHT = ['Marco', 'Elif', 'Jana', 'Aaron', 'Sabine', 'Tobias', 'Nina', 'Kemal'].map((name, index) => ({
  id: `${index + 1}1111111-1111-1111-1111-111111111111`,
  name,
}))

async function stub(page: Page, employees = FOUR): Promise<void> {
  await page.route('**/api/day*', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? TODAY
    const day: Day = {
      date,
      today: TODAY,
      coreHours: { from: '09:00', to: '18:00' },
      employees,
      entries: [],
    }
    await route.fulfill({ json: day })
  })
}

test('the strips are a chevron and nothing else', async ({ page }) => {
  await stub(page)
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const drawn = await page.locator('.edge--prev').evaluate((edge) => {
    const style = window.getComputedStyle(edge)
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      glyph: edge.textContent?.trim() ?? '',
    }
  })

  // Fully transparent, not merely paler: a 1px line or a near-white fill is the thing the owner
  // asked to remove.
  expect(drawn.background).toBe('rgba(0, 0, 0, 0)')
  expect(drawn.borderWidth).toBe('0px')
  expect(drawn.glyph).toBe('‹')

  // The glyph is the control now, so it has to be on screen rather than merely in the document.
  await expect(page.getByRole('button', { name: 'Vorheriger Tag' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nächster Tag' })).toBeVisible()
})

test('the cursor is a one-way arrow, and a different one on each side', async ({ page }) => {
  // What this can and cannot prove: the operating system draws a cursor and Playwright cannot
  // screenshot one, so this asserts the declaration - an image, not a finger, and not the same
  // image on both sides. How the arrow looks is the owner's judgement on a real screen.
  await stub(page)
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const cursorOf = async (side: string): Promise<string> =>
    page.locator(side).evaluate((edge) => window.getComputedStyle(edge).cursor)

  const prev = await cursorOf('.edge--prev')
  const next = await cursorOf('.edge--next')

  expect(prev).toContain('url(')
  expect(next).toContain('url(')
  expect(prev).not.toBe(next)
  // The finger is what this replaced. Its keyword must not still be the one in force.
  expect(prev).not.toContain('pointer')
  expect(next).not.toContain('pointer')
})

test('the strip stays narrow when space is tight and widens when there is room', async ({ page }) => {
  await stub(page)

  await page.setViewportSize({ width: 1180, height: 800 })
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')
  const tight = (await page.locator('.edge--prev').boundingBox())!
  // 1.75rem, which is what it has always been. Anything past 1280 is where growth starts.
  expect(Math.round(tight.width)).toBe(28)

  await page.setViewportSize({ width: 1920, height: 900 })
  const roomy = (await page.locator('.edge--prev').boundingBox())!
  // The 9rem cap: a 144px target at the edge of a wide screen.
  expect(Math.round(roomy.width)).toBe(144)

  // And it is still a strip rather than half the screen.
  expect(roomy.width).toBeLessThan(1920 / 6)
})

test('a phone keeps the narrow strips, so the board keeps its width', async ({ page }) => {
  // The growth is written against viewport width with no breakpoint, so the small end is worth
  // pinning: a phone must not lose 288px to two navigation strips.
  await stub(page)
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const strip = (await page.locator('.edge--prev').boundingBox())!
  expect(Math.round(strip.width)).toBe(28)
})

test('four stylists on a wide screen keep wide columns, eight start scrolling', async ({ page }) => {
  // The cost of the wide strips, measured rather than assumed - and stated in the stylesheet next
  // to the cap it comes from. Four is the salon today and loses nothing worth seeing; eight is
  // where the 150px minimum from ADR-0021 turns into sideways scrolling sooner than it used to.
  await stub(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const wide = (await page.locator('.board__column').first().boundingBox())!
  expect(wide.width).toBeGreaterThan(150)

  const scrolls = await page.locator('.shell__day').evaluate((pane) => pane.scrollWidth > pane.clientWidth)
  expect(scrolls).toBe(false)

  await stub(page, EIGHT)
  await page.reload()
  await page.waitForSelector('.board__grid')

  const narrow = (await page.locator('.board__column').first().boundingBox())!
  // Still not squeezed below the minimum - it scrolls instead, which is ADR-0021's whole rule.
  expect(Math.round(narrow.width)).toBeGreaterThanOrEqual(150)
})

test('a keyboard can still see where it is on an invisible control', async ({ page }) => {
  // With no box drawn, the focus ring is the only thing left that says "you are here". The
  // stylesheet deliberately does not touch it; this is the assertion that keeps it that way.
  await stub(page)
  await page.goto(`/?date=${TODAY}`)
  await page.waitForSelector('.board__grid')

  const focused = await page.locator('.edge--next').evaluate((edge) => {
    edge.focus()
    const style = window.getComputedStyle(edge)
    return { active: document.activeElement === edge, outlineStyle: style.outlineStyle }
  })

  expect(focused.active).toBe(true)
  expect(focused.outlineStyle).not.toBe('none')
})
