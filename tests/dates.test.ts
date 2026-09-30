import { describe, expect, it } from 'vitest'
import { addDays, addWeeks, germanWeekday, isoWeek, longGermanDate } from '../src/calendar/dates.js'
import { isSalonDate } from '../src/calendar/salon-date.js'

/** A step that is expected to land somewhere. Fails loudly rather than typing `!`. */
function stepped(result: string | null): string {
  if (result === null) throw new Error('expected the step to produce a date')
  return result
}

// ADR-0010. The boundary dates below are a fixed table taken from the ADR, which took them
// from the system's own date implementation. They are not generated, because the whole point
// is to pin the cases that a comfortable mid-year date hides.

describe('isoWeek', () => {
  it('numbers an ordinary week', () => {
    expect(isoWeek('2026-08-13')).toEqual({ week: 33, weekYear: 2026 })
  })

  it('knows that 2026 has a week 53', () => {
    // Any code assuming weeks run 1 to 52 is wrong this year.
    expect(isoWeek('2026-12-28')).toEqual({ week: 53, weekYear: 2026 })
    expect(isoWeek('2026-12-31')).toEqual({ week: 53, weekYear: 2026 })
  })

  it('puts the first days of 2027 in week 53 of 2026', () => {
    // The bug this ADR exists for. The header must read KW 53 on a date saying 2027, for
    // six consecutive days, and the salon reaches it on 28 December 2026.
    expect(isoWeek('2027-01-01')).toEqual({ week: 53, weekYear: 2026 })
    expect(isoWeek('2027-01-03')).toEqual({ week: 53, weekYear: 2026 })
    expect(isoWeek('2027-01-04')).toEqual({ week: 1, weekYear: 2027 })
  })

  it('puts 1 January 2021 in week 53 of 2020', () => {
    // Not a one-off in 2026: the same shape recurs whenever a year turns on the wrong day.
    expect(isoWeek('2021-01-01')).toEqual({ week: 53, weekYear: 2020 })
  })

  it('starts week 1 where ISO says, not on 1 January', () => {
    expect(isoWeek('2026-01-01')).toEqual({ week: 1, weekYear: 2026 })
    // 2022 began on a Saturday, so 1 January belongs to the previous week-year.
    expect(isoWeek('2022-01-01')).toEqual({ week: 52, weekYear: 2021 })
    expect(isoWeek('2022-01-03')).toEqual({ week: 1, weekYear: 2022 })
  })

  it('treats Sunday as the last day of its week, not the first', () => {
    // 2026-08-16 is a Sunday; it belongs to KW 33 with the Thursday before it, not KW 34.
    expect(isoWeek('2026-08-16')).toEqual({ week: 33, weekYear: 2026 })
    expect(isoWeek('2026-08-17')).toEqual({ week: 34, weekYear: 2026 })
  })
})

describe('addDays', () => {
  it('crosses a month and a year', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
  })
})

describe('addWeeks', () => {
  it('keeps the weekday, which is the point of the button', () => {
    // A customer asking for the same slot in four weeks: four clicks, same Thursday.
    const start = '2026-08-13'
    expect(isoWeek(start).week).toBe(33)

    const fourWeeksOn = stepped(addWeeks(start, 4))
    expect(fourWeeksOn).toBe('2026-09-10')
    expect(new Date(`${fourWeeksOn}T00:00:00Z`).getUTCDay()).toBe(4)
    expect(isoWeek(fourWeeksOn).week).toBe(37)
  })

  it('steps backwards across a year boundary', () => {
    expect(addWeeks('2027-01-07', -2)).toBe('2026-12-24')
  })
})

describe('the edges of the representable calendar', () => {
  it('refuses a year below 1000 at the boundary, because the arithmetic silently lies there', () => {
    // Date.UTC(50, 0, 1) means 1950, not year 50, so isoWeek('0050-03-15') used to return
    // KW -99126. Rather than patch each function, the validator refuses the whole family -
    // nothing books in the first millennium, and everything downstream may now assume four
    // real digits.
    expect(isSalonDate('0050-03-15')).toBe(false)
    expect(isSalonDate('0999-12-31')).toBe(false)
    expect(isSalonDate('0001-01-01')).toBe(false)
    expect(isSalonDate('1000-01-01')).toBe(true)
  })

  it('goes nowhere rather than past the end of the calendar', () => {
    // toISOString switches to an expanded year form beyond 9999, so one click of "next day"
    // from an accepted 9999-12-31 used to put `+010000-01` in the address bar.
    expect(addDays('9999-12-31', 1)).toBeNull()
    expect(addWeeks('9999-12-30', 1)).toBeNull()

    // And backwards, out of the range the validator accepts.
    expect(addDays('1000-01-01', -1)).toBeNull()
  })

  it('still steps normally just inside the edges', () => {
    expect(addDays('9999-12-30', 1)).toBe('9999-12-31')
    expect(addDays('1000-01-01', 1)).toBe('1000-01-02')
  })
})

describe('germanWeekday', () => {
  it('names all seven, Monday first, as ISO 8601 counts them', () => {
    // The settings screen labels its seven rows with these and the server names the weekday in a
    // refusal with them, so an off-by-one here would tell somebody Saturday was refused when it
    // was Sunday. Written out in full rather than spot-checked for exactly that reason.
    expect([1, 2, 3, 4, 5, 6, 7].map(germanWeekday)).toEqual([
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
      'Sonntag',
    ])
  })

  it('agrees with the weekday longGermanDate names for the same day', () => {
    // Two spellings of Mittwoch is the thing this test exists to stop: one from a hardcoded list
    // and one from Intl would drift the day somebody edited the list.
    expect(longGermanDate('2026-08-13').startsWith(germanWeekday(4))).toBe(true)
    expect(longGermanDate('2026-08-16').startsWith(germanWeekday(7))).toBe(true)
  })
})

describe('longGermanDate', () => {
  it('names the day the German way', () => {
    expect(longGermanDate('2026-08-13')).toBe('Donnerstag, 13. August 2026')
  })

  it('names the day that was asked for, whatever the machine thinks the time is', () => {
    // Formatted from the date string in UTC. Going through a local Date is how a calendar
    // ends up captioning the wrong day for anybody east or west of the server.
    expect(longGermanDate('2027-01-01')).toBe('Freitag, 1. Januar 2027')
    expect(longGermanDate('2026-12-31')).toBe('Donnerstag, 31. Dezember 2026')
  })
})
