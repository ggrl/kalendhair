import { describe, expect, it } from 'vitest'
import {
  DAY_ENDS_AT,
  DAY_STARTS_AT,
  SLOT_COUNT,
  SLOT_MINUTES,
  hourLabels,
  isPlaceable,
  whyNotBookable,
  minutesSinceMidnight,
  slotFromWallClock,
} from '../src/calendar/grid.js'

describe('the shape of the board', () => {
  it('runs 06:00 to 20:00 in 15-minute steps', () => {
    expect(DAY_STARTS_AT).toBe('06:00')
    expect(DAY_ENDS_AT).toBe('20:00')
    expect(SLOT_MINUTES).toBe(15)
    // Fourteen hours of quarter-hours. If this number changes, every box moves.
    expect(SLOT_COUNT).toBe(56)
  })

  it('labels every hour inclusive of both ends', () => {
    const labels = hourLabels()
    expect(labels).toHaveLength(15)
    expect(labels[0]).toBe('06:00')
    expect(labels.at(-1)).toBe('20:00')
  })
})

describe('minutesSinceMidnight', () => {
  it('reads a wall clock time', () => {
    expect(minutesSinceMidnight('06:00')).toBe(360)
    expect(minutesSinceMidnight('09:45')).toBe(585)
    expect(minutesSinceMidnight('20:00')).toBe(1200)
  })
})

describe('slotFromWallClock', () => {
  it('puts the first bookable time at the top', () => {
    expect(slotFromWallClock('06:00')).toBe(0)
  })

  it('counts quarter hours', () => {
    expect(slotFromWallClock('06:15')).toBe(1)
    expect(slotFromWallClock('07:00')).toBe(4)
    expect(slotFromWallClock('20:00')).toBe(SLOT_COUNT)
  })

  it('returns a fraction for a time the grid cannot draw', () => {
    // Not rounded. A time off the quarter hour is data the board cannot place honestly, and
    // the caller has to see that rather than have it snapped into a neighbouring row.
    expect(Number.isInteger(slotFromWallClock('09:07'))).toBe(false)
  })

  it('returns a negative slot for a time before the board starts', () => {
    expect(slotFromWallClock('05:45')).toBe(-1)
  })
})

describe('isPlaceable', () => {
  it('accepts what the grid can draw, including both extremes', () => {
    expect(isPlaceable('06:00', '06:15')).toBe(true)
    expect(isPlaceable('19:45', '20:00')).toBe(true)
    expect(isPlaceable('06:00', '20:00')).toBe(true)
  })

  it('refuses times outside the drawn window', () => {
    expect(isPlaceable('05:45', '07:00')).toBe(false)
    expect(isPlaceable('19:00', '21:00')).toBe(false)
  })

  it('refuses a time that is not on a quarter hour', () => {
    expect(isPlaceable('09:07', '09:37')).toBe(false)
  })

  it('refuses a zero-length or backwards range', () => {
    // Without this the name was a promise the function did not keep: `span 0` and a negative
    // span are invalid, so the browser dropped the box out of the grid and stacked it below the
    // board with no explanation, and it did not appear in the report for undrawable entries.
    // The database forbids both; the predicate now does too.
    expect(isPlaceable('10:00', '10:00')).toBe(false)
    expect(isPlaceable('13:00', '12:00')).toBe(false)
  })
})

describe('whyNotBookable', () => {
  // One home for "can this be booked", because the browser refuses a typed time before saving
  // and the server refuses it again whatever the browser did. Two copies would agree today.

  it('accepts an ordinary booking', () => {
    expect(whyNotBookable('10:00', '11:00')).toBeNull()
    expect(whyNotBookable('06:00', '06:15')).toBeNull()
    expect(whyNotBookable('19:45', '20:00')).toBeNull()
    expect(whyNotBookable('06:00', '20:00')).toBeNull()
  })

  it('refuses a drag that ended where it started', () => {
    expect(whyNotBookable('10:00', '10:00')).toMatch(/Ende muss nach dem Beginn/)
  })

  it('refuses a backwards range', () => {
    expect(whyNotBookable('13:00', '12:00')).toMatch(/Ende muss nach dem Beginn/)
  })

  it('refuses a time off the quarter hour', () => {
    expect(whyNotBookable('10:07', '11:00')).toMatch(/Viertelstunde/)
    expect(whyNotBookable('10:00', '11:20')).toMatch(/Viertelstunde/)
  })

  it('refuses times outside the salon day', () => {
    expect(whyNotBookable('05:45', '07:00')).toMatch(/06:00 und 20:00/)
    expect(whyNotBookable('19:30', '20:30')).toMatch(/06:00 und 20:00/)
  })

  it('refuses anything that is not a wall clock time', () => {
    // The modal lets these be typed, so they arrive as text and have to be refused as text
    // rather than becoming NaN somewhere further in.
    for (const value of ['morgens', '', '10', '10:0', '25:00', '10:60', '9:00', '10:00:00']) {
      expect(whyNotBookable(value, '11:00')).toMatch(/HH:MM/)
    }
  })

  it('checks the order before the grid, so the clearest problem is the one reported', () => {
    // 13:07 to 12:07 is both backwards and off the quarter hour. Being told it is backwards is
    // more use than being told about the grid.
    expect(whyNotBookable('13:07', '12:07')).toMatch(/Ende muss nach dem Beginn/)
  })
})
