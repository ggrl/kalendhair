import { describe, expect, it } from 'vitest'
import type { Entry } from '../src/calendar/types.js'
import { SLOT_COUNT } from '../src/calendar/grid.js'
import { previewOf } from '../src/ui/gesture.js'
import type { Gesture } from '../src/ui/gesture.js'

// The arithmetic a drag writes with, on its own, in `npm run verify`. The browser suite proves the
// gestures end to end but is not part of the commit gate, and a logic review found the top-edge
// branch had no test anywhere - it was right, and this is that gap closed.

const MARCO = 'marco'
const JANA = 'jana'

/** 09:00-10:00, which is rows 12 to 16. */
const ANNA: Entry = {
  id: 'a1',
  version: 3,
  employeeId: MARCO,
  kind: 'appointment',
  startsAt: '09:00',
  endsAt: '10:00',
  customer: 'Anna Schmidt',
  treatment: 'Farbe',
  notes: null,
  reason: null,
  colour: '#f4b8b8',
}

/** The fields every gesture carries. None of them reach `previewOf`; they decide other things. */
const held = { date: '2026-08-13', fromY: 0, travelled: true }

function move(slot: number, employeeId = MARCO): Gesture {
  return { ...held, kind: 'move', entry: ANNA, employeeId, anchorSlot: 13, slot }
}

function resize(edge: 'top' | 'bottom', slot: number): Gesture {
  return { ...held, kind: 'resize', entry: ANNA, edge, slot }
}

function create(anchorSlot: number, slot: number): Gesture {
  return { ...held, kind: 'create', employeeId: MARCO, anchorSlot, slot }
}

describe('dragging a box to another time', () => {
  it('slides by the rows the pointer travelled, keeping the length', () => {
    // Grabbed on row 13, released on row 29: sixteen rows, so 09:00-10:00 becomes 13:00-14:00.
    expect(previewOf(move(29))).toEqual({ employeeId: MARCO, startSlot: 28, endSlot: 32, changed: true })
  })

  it('reports no change when it lands where it started', () => {
    expect(previewOf(move(13)).changed).toBe(false)
  })

  it('counts a different column as a change even at the same time', () => {
    const preview = previewOf(move(13, JANA))
    expect(preview).toEqual({ employeeId: JANA, startSlot: 12, endSlot: 16, changed: true })
  })

  it('stops at both edges of the board instead of hanging off them', () => {
    // Dragged towards 05:00 and towards 21:00. Both clamp, and an hour stays an hour.
    expect(previewOf(move(0))).toMatchObject({ startSlot: 0, endSlot: 4 })
    expect(previewOf(move(SLOT_COUNT - 1))).toMatchObject({ startSlot: SLOT_COUNT - 4, endSlot: SLOT_COUNT })
  })
})

describe('dragging an edge', () => {
  it('moves the bottom and leaves the start alone', () => {
    expect(previewOf(resize('bottom', 19))).toEqual({ employeeId: MARCO, startSlot: 12, endSlot: 20, changed: true })
  })

  it('moves the top and leaves the end alone', () => {
    // The branch no test touched until a review said so. 08:00 is row 8.
    expect(previewOf(resize('top', 8))).toEqual({ employeeId: MARCO, startSlot: 8, endSlot: 16, changed: true })
  })

  it('never lets either edge cross the other', () => {
    // One slot is the floor: `appointment_positive_duration` refuses anything shorter, and the
    // grid cannot draw it.
    expect(previewOf(resize('top', 40))).toMatchObject({ startSlot: 15, endSlot: 16 })
    expect(previewOf(resize('bottom', 2))).toMatchObject({ startSlot: 12, endSlot: 13 })
  })

  it('stays on the board when dragged past either end', () => {
    expect(previewOf(resize('top', -20))).toMatchObject({ startSlot: 0, endSlot: 16 })
    expect(previewOf(resize('bottom', SLOT_COUNT + 20))).toMatchObject({ startSlot: 12, endSlot: SLOT_COUNT })
  })

  it('reports no change when the edge returns to where it was', () => {
    expect(previewOf(resize('bottom', 15)).changed).toBe(false)
    expect(previewOf(resize('top', 12)).changed).toBe(false)
  })
})

describe('dragging a range out of empty grid', () => {
  it('covers every row the pointer crossed, inclusive of the one it ended on', () => {
    expect(previewOf(create(16, 19))).toEqual({ employeeId: MARCO, startSlot: 16, endSlot: 20, changed: true })
  })

  it('reads the same dragged upwards', () => {
    expect(previewOf(create(19, 16))).toEqual({ employeeId: MARCO, startSlot: 16, endSlot: 20, changed: true })
  })

  it('is one row long, and unchanged, when it ends where it began', () => {
    expect(previewOf(create(16, 16))).toEqual({ employeeId: MARCO, startSlot: 16, endSlot: 17, changed: false })
  })
})
