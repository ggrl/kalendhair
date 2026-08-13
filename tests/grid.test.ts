import { describe, expect, it } from 'vitest'
import {
  DAY_ENDS_AT,
  DAY_STARTS_AT,
  SLOT_COUNT,
  SLOT_MINUTES,
  hourLabels,
  isPlaceable,
  TIME_TAKEN,
  whyNotBookable,
  whyNotFree,
  minutesSinceMidnight,
  rangeFromSlots,
  slotAt,
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

describe('a range dragged out on the grid', () => {
  it('turns slots into wall clock times', () => {
    // Slot 0 is 06:00. Sixteen quarter hours later is 10:00.
    expect(rangeFromSlots(16, 20)).toEqual({ startsAt: '10:00', endsAt: '11:00' })
  })

  it('clamps a drag that runs off either end of the board', () => {
    // Dragging above 06:00 or below 20:00 stops at the edge. The cursor being past the end of the
    // board is not a mistake worth a message.
    expect(rangeFromSlots(-8, 4)).toEqual({ startsAt: '06:00', endsAt: '07:00' })
    expect(rangeFromSlots(52, 60)).toEqual({ startsAt: '19:00', endsAt: '20:00' })
  })

  it('never collapses to nothing, whichever way the drag went', () => {
    // `appointment_positive_duration` refuses a zero-length entry, and the grid cannot draw one.
    expect(rangeFromSlots(16, 16)).toEqual({ startsAt: '10:00', endsAt: '10:15' })
    expect(rangeFromSlots(16, 8)).toEqual({ startsAt: '10:00', endsAt: '10:15' })
    // The last row keeps its slot rather than being pushed past closing time.
    expect(rangeFromSlots(56, 56)).toEqual({ startsAt: '19:45', endsAt: '20:00' })
  })

  it('agrees with slotAt, which is the same question one slot long', () => {
    expect(slotAt(16)).toEqual(rangeFromSlots(16, 17))
  })
})

describe('whether a drop lands on occupied time', () => {
  const MARCO = 'marco'
  const JANA = 'jana'
  const booked = [
    { id: 'a1', employeeId: MARCO, startsAt: '10:00', endsAt: '11:00' },
    { id: 'b1', employeeId: JANA, startsAt: '14:00', endsAt: '15:00' },
  ]

  it('refuses time that overlaps the same person', () => {
    expect(whyNotFree(booked, { employeeId: MARCO, startsAt: '10:30', endsAt: '11:30' })).toBe(TIME_TAKEN)
    // Swallowing an existing entry whole is still an overlap.
    expect(whyNotFree(booked, { employeeId: MARCO, startsAt: '09:00', endsAt: '12:00' })).toBe(TIME_TAKEN)
  })

  it('allows a neighbour that starts exactly where the last one ended', () => {
    // The constraint compares `tsrange(starts_at, ends_at, '[)')`, so touching is not
    // overlapping. A 15-minute grid is nothing but adjacent appointments: inclusive bounds here
    // would refuse almost every real booking.
    expect(whyNotFree(booked, { employeeId: MARCO, startsAt: '11:00', endsAt: '11:30' })).toBeNull()
    expect(whyNotFree(booked, { employeeId: MARCO, startsAt: '09:00', endsAt: '10:00' })).toBeNull()
  })

  it('does not mind the same time on somebody else', () => {
    expect(whyNotFree(booked, { employeeId: JANA, startsAt: '10:00', endsAt: '11:00' })).toBeNull()
  })

  it('lets an entry keep the time it already holds', () => {
    // A resize overlaps almost all of itself, so without this every resize would be refused.
    expect(whyNotFree(booked, { id: 'a1', employeeId: MARCO, startsAt: '10:00', endsAt: '11:30' })).toBeNull()
  })

  it('says nothing about an empty day', () => {
    expect(whyNotFree([], { employeeId: MARCO, startsAt: '10:00', endsAt: '11:00' })).toBeNull()
  })
})
