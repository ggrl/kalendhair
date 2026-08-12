import { describe, expect, it } from 'vitest'
import { assertKnownTimeZone, isSalonDate, todayIn } from '../src/calendar/salon-date.js'

describe('isSalonDate', () => {
  it('accepts a real date', () => {
    expect(isSalonDate('2026-08-13')).toBe(true)
  })

  it('accepts the end of a leap February', () => {
    expect(isSalonDate('2028-02-29')).toBe(true)
  })

  it('rejects a day that does not exist', () => {
    // new Date('2026-02-30') rolls silently forward into March. A calendar that shows a
    // day nobody asked for is worse than one that refuses the input.
    expect(isSalonDate('2026-02-30')).toBe(false)
    expect(isSalonDate('2027-02-29')).toBe(false)
    expect(isSalonDate('2026-13-01')).toBe(false)
  })

  it('rejects anything not shaped like YYYY-MM-DD', () => {
    expect(isSalonDate('2026-8-13')).toBe(false)
    expect(isSalonDate('13.08.2026')).toBe(false)
    expect(isSalonDate('2026-08-13T10:00:00Z')).toBe(false)
    expect(isSalonDate('')).toBe(false)
    expect(isSalonDate('tomorrow')).toBe(false)
  })
})

describe('todayIn', () => {
  it('answers in the salon timezone, not the machine one', () => {
    // One instant, two answers. Berlin has already turned over; New York has not.
    const instant = new Date('2026-08-14T00:30:00Z')
    expect(todayIn('Europe/Berlin', instant)).toBe('2026-08-14')
    expect(todayIn('America/New_York', instant)).toBe('2026-08-13')
  })

  it('is right either side of a daylight-saving change', () => {
    // Central European Summer Time ends on 25 October 2026. The salon's date must not
    // wobble across it.
    expect(todayIn('Europe/Berlin', new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25')
    expect(todayIn('Europe/Berlin', new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25')
  })

  it('pads single-digit months and days', () => {
    expect(todayIn('Europe/Berlin', new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05')
  })
})

describe('assertKnownTimeZone', () => {
  it('accepts a real zone', () => {
    expect(() => assertKnownTimeZone('Europe/Berlin')).not.toThrow()
  })

  it('refuses a made-up one rather than defaulting', () => {
    expect(() => assertKnownTimeZone('Europe/Salon')).toThrow(/SALON_TIMEZONE/)
  })
})
