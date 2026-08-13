import { describe, expect, it } from 'vitest'
import { coreHoursOn, weekdayOf } from '../src/calendar/opening.js'

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

  it('knows nothing about public holidays, deliberately', () => {
    // 25 December 2026 is a Friday and reads as an ordinary working day. There is no calendar of
    // holidays and this does not invent one - the paper page did not have one either.
    expect(coreHoursOn('2026-12-25')).toEqual({ from: '09:00', to: '18:00' })
  })
})
