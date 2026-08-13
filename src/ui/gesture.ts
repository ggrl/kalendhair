// The maths of a drag, with no DOM in it.
//
// Its own module because it is pure and worth unit testing on its own: `npm run verify` does not
// run the browser suite, so arithmetic that decides what a drag writes would otherwise be covered
// only by tests the commit gate never sees. It also keeps `Board.tsx` to one exported component,
// which is what the fast-refresh rule asks for.

import type { Entry } from '../calendar/types'
import { SLOT_COUNT, slotFromWallClock } from '../calendar/grid'

/** What every gesture carries, whatever it turns out to be. */
interface Held {
  /**
   * The day that was on screen when the pointer went down, so the write cannot land on another.
   *
   * Reading the day at release time was a verified defect: `popstate` - a mouse's back
   * side-button, or Alt and Left - swaps the board without any pointer event of its own, pointer
   * capture keeps the gesture alive through the swap, and the release then wrote to a day nobody
   * was looking at. It is the same defect the form had, fixed the same way, in the same session.
   */
  date: string
  /** Where the pointer went down, in pixels down the page. Only used to decide `travelled`. */
  fromY: number
  /**
   * Whether the pointer has moved far enough for this to be a drag rather than a click.
   *
   * **Pixels, not rows.** Comparing slots looked like a threshold and was not one: a row is
   * 17.6px, so a hand twitching three pixels across a row line wrote a fifteen-minute change with
   * no dialogue and no undo, from about a third of every box. A review pass demonstrated it, and
   * the test that was supposed to cover it passed only because the box centre it grabbed happened
   * to sit exactly on a row boundary.
   *
   * Once true it stays true: a drag that wanders back to where it started is still a drag, and it
   * ends by writing nothing rather than by opening the form.
   */
  travelled: boolean
}

/**
 * A gesture in progress. Three kinds, because the release means three different things: propose a
 * range, move an entry, or change one of its ends.
 *
 * `slot` is where the pointer is now. Everything the board writes comes from slots, not pixels, so
 * it can only ever propose a time it can also draw.
 */
export type Gesture =
  | (Held & { kind: 'create'; employeeId: string; anchorSlot: number; slot: number })
  | (Held & { kind: 'move'; entry: Entry; employeeId: string; anchorSlot: number; slot: number })
  | (Held & { kind: 'resize'; entry: Entry; edge: 'top' | 'bottom'; slot: number })

export interface Preview {
  employeeId: string
  startSlot: number
  endSlot: number
  /**
   * Whether this points anywhere other than where the entry already is. It decides WHAT to write,
   * never WHETHER to write - `travelled` decides that, and in pixels.
   */
  changed: boolean
}

/**
 * Where the gesture currently points, in rows and columns.
 *
 * Exported for its own unit tests: the browser suite is not part of `npm run verify`, and this is
 * the arithmetic that decides what a drag writes.
 */
export function previewOf(gesture: Gesture): Preview {
  if (gesture.kind === 'create') {
    const first = Math.min(gesture.anchorSlot, gesture.slot)
    const last = Math.max(gesture.anchorSlot, gesture.slot)
    return {
      employeeId: gesture.employeeId,
      startSlot: first,
      endSlot: last + 1,
      changed: gesture.slot !== gesture.anchorSlot,
    }
  }

  const held = gesture.entry
  const start = slotFromWallClock(held.startsAt)
  const end = slotFromWallClock(held.endsAt)

  if (gesture.kind === 'resize') {
    // One slot is the floor. Dragging an edge past its opposite would otherwise ask for a
    // zero-length or backwards entry, which the database refuses and the grid cannot draw.
    const startSlot = gesture.edge === 'top' ? Math.max(Math.min(gesture.slot, end - 1), 0) : start
    const endSlot = gesture.edge === 'bottom' ? Math.min(Math.max(gesture.slot + 1, start + 1), SLOT_COUNT) : end
    return { employeeId: held.employeeId, startSlot, endSlot, changed: startSlot !== start || endSlot !== end }
  }

  // A move keeps its length and slides. Clamped so the whole box stays on the board: dragging
  // towards 21:00 stops at 20:00 rather than proposing a time the server would refuse, and an
  // hour-long appointment stays an hour long.
  const shift = Math.min(Math.max(gesture.slot - gesture.anchorSlot, -start), SLOT_COUNT - end)
  return {
    employeeId: gesture.employeeId,
    startSlot: start + shift,
    endSlot: end + shift,
    changed: shift !== 0 || gesture.employeeId !== held.employeeId,
  }
}
