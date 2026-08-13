import { describe, expect, it } from 'vitest'
import {
  HOLIDAYS_COVERED_THROUGH,
  HOLIDAY_SOURCE,
  coreHoursOn,
  isHoliday,
  weekdayOf,
} from '../src/calendar/opening.js'

// The salon's core hours, which shade the board and refuse nothing. Fixed dates rather than
// anything derived from today: a weekday table tested on a Wednesday passes for the wrong reason.
//
// The week of 2026-08-10 is a Monday to Sunday run, which is what these lean on.

describe('which weekday a salon date is', () => {
  it('counts Monday as 1 and Sunday as 7', () => {
    expect(weekdayOf('2026-08-10')).toBe(1)
    expect(weekdayOf('2026-08-15')).toBe(6)
    expect(weekdayOf('2026-08-16')).toBe(7)
  })

  it('does not shift with the machine, because it parses as UTC', () => {
    // A date parsed in local time is the day before in any timezone behind UTC, which would
    // silently move every shaded band by one day for a stylist checking from abroad: ADR-0007.
    expect(weekdayOf('2026-01-01')).toBe(4)
    expect(weekdayOf('2027-01-01')).toBe(5)
  })
})

describe('the salon core hours', () => {
  it('works 09:00 to 18:00 from Tuesday to Friday', () => {
    for (const date of ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']) {
      expect(coreHoursOn(date)).toEqual({ from: '09:00', to: '18:00' })
    }
  })

  it('works 08:00 to 13:30 on Saturday', () => {
    // Half past one, which lands on a quarter-hour row: the grid could not draw the edge of the
    // shading otherwise.
    expect(coreHoursOn('2026-08-15')).toEqual({ from: '08:00', to: '13:30' })
  })

  it('is closed all day on Sunday and Monday', () => {
    expect(coreHoursOn('2026-08-16')).toBeNull()
    expect(coreHoursOn('2026-08-10')).toBeNull()
  })

  it('is closed on a Hessen public holiday that falls on a working day', () => {
    // This asserted the opposite until ADR-0016 added the list: 25 December 2026 is a Friday, and
    // it read as an ordinary working day. Reversed deliberately, so the test was rewritten.
    expect(weekdayOf('2026-12-25')).toBe(5)
    expect(coreHoursOn('2026-12-25')).toBeNull()
  })

  it('leaves the working day next to a holiday alone', () => {
    // The day after Christmas is also a holiday; the 24th is not, whatever the salon chooses to do
    // about it. Heiligabend is not a public holiday in Hessen and the list does not invent one.
    expect(coreHoursOn('2026-12-24')).toEqual({ from: '09:00', to: '18:00' })
  })
})

describe('the Hessen holiday list', () => {
  it('knows the fixed dates', () => {
    for (const date of ['2026-01-01', '2026-05-01', '2026-10-03', '2026-12-25', '2026-12-26']) {
      expect(isHoliday(date)).toBe(true)
    }
  })

  it('knows the moving ones, which is what a list is for', () => {
    // Easter 2026 is 5 April: Karfreitag is two days before, Himmelfahrt is Easter plus 39,
    // Pfingstmontag plus 50, Fronleichnam plus 60. Checked against the arithmetic before the
    // dates were written down, because a wrong holiday is a wrong colour nobody would question.
    for (const date of ['2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04']) {
      expect(isHoliday(date)).toBe(true)
    }
    // 2027 moves: Easter is 28 March.
    for (const date of ['2027-03-26', '2027-03-29', '2027-05-06', '2027-05-17', '2027-05-27']) {
      expect(isHoliday(date)).toBe(true)
    }
  })

  it('has none of the holidays Hessen does not keep', () => {
    // Reformationstag and Allerheiligen are holidays in other states. A list copied from the wrong
    // one would close the salon on a day it is working, which is the more expensive mistake.
    expect(isHoliday('2026-10-31')).toBe(false)
    expect(isHoliday('2026-11-01')).toBe(false)
    // Buß- und Bettag is Saxony only.
    expect(isHoliday('2026-11-18')).toBe(false)
  })

  it('says nothing about dates past the end of the list', () => {
    expect(isHoliday('2031-01-01')).toBe(false)
  })

  it('still has at least a year left to run', () => {
    // A deliberate time bomb, and the only mechanism that will notice. The list is hardcoded, so
    // it expires quietly: the board simply stops marking holidays and looks exactly as correct as
    // it did the day before. This fails a year ahead of that, in CI, with the URL in the message.
    //
    // It is the one test here that reads the clock. Everything else uses fixed dates on purpose.
    const oneYearOut = new Date()
    oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1)
    const deadline = oneYearOut.toISOString().slice(0, 10)

    expect(
      HOLIDAYS_COVERED_THROUGH >= deadline,
      `The Hessen holiday list ends on ${HOLIDAYS_COVERED_THROUGH}, which is less than a year away. ` +
        `Refresh it in src/calendar/opening.ts from ${HOLIDAY_SOURCE} (one request per year), check the ` +
        `dates against the Easter arithmetic, and move HOLIDAYS_COVERED_THROUGH.`,
    ).toBe(true)
  })
})
