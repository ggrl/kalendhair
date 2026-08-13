// The shape of the board: which hours it draws and how finely.
//
// This is the single home for the bookable window. `migrations/001_init.sql` deliberately
// does NOT enforce 06:00-20:00 in SQL, precisely so that changing the salon's hours is a
// change here and not a migration. Anything that needs to know the window asks this file.

export const DAY_STARTS_AT = '06:00'
export const DAY_ENDS_AT = '20:00'

/** The smallest bookable step. Fifteen minutes, so a whole day is 56 rows. */
export const SLOT_MINUTES = 15

/** Wall clock `HH:MM` to minutes since midnight. Salon-local throughout: ADR-0007. */
export function minutesSinceMidnight(wallClock: string): number {
  const [hours, minutes] = wallClock.split(':')
  return Number(hours) * 60 + Number(minutes)
}

export const SLOT_COUNT =
  (minutesSinceMidnight(DAY_ENDS_AT) - minutesSinceMidnight(DAY_STARTS_AT)) / SLOT_MINUTES

/**
 * Which 15-minute row a time falls on, counting from 0 at the top of the board.
 *
 * Fractional results are possible and deliberately not rounded away: a time that is not on
 * a quarter hour is data the grid cannot draw honestly, and the caller should see that
 * rather than have it quietly snapped to a neighbouring row.
 */
export function slotFromWallClock(wallClock: string): number {
  return (minutesSinceMidnight(wallClock) - minutesSinceMidnight(DAY_STARTS_AT)) / SLOT_MINUTES
}

/**
 * Whether a time range can be drawn on the grid at all: both ends on a quarter hour, and
 * inside the window. Takes times rather than an entry so this file keeps its promise to
 * import nothing, and so the board and the box cannot disagree about what is drawable.
 */
export function isPlaceable(startsAt: string, endsAt: string): boolean {
  const start = slotFromWallClock(startsAt)
  const end = slotFromWallClock(endsAt)
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= SLOT_COUNT &&
    // Without this the name is a promise the function does not keep. A zero-length or
    // backwards range produced `span 0` or a negative span, which the browser rejects - so the
    // box fell out of the grid and stacked below the board with no explanation, and it was not
    // in the report that exists for undrawable entries. `appointment_positive_duration` makes
    // both impossible in the database; this makes the predicate true on its own terms.
    end > start
  )
}

/** Minutes since midnight back to `HH:MM`. The inverse of `minutesSinceMidnight`. */
export function wallClockFromMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * A range of slots as wall clock times, clamped to the board.
 *
 * `endSlot` is exclusive, and the clamping is what stops a drag off the top or the bottom of the
 * grid from proposing a time the server would refuse: dragging above 06:00 or below 20:00 stops
 * at the edge rather than springing back with a message, because the cursor being past the edge
 * of the board is not a mistake anybody needs telling about.
 *
 * The floor of one slot is here too. A drag that collapses a box to nothing would otherwise
 * produce `ends_at = starts_at`, which `appointment_positive_duration` refuses.
 */
export function rangeFromSlots(startSlot: number, endSlot: number): { startsAt: string; endsAt: string } {
  const first = minutesSinceMidnight(DAY_STARTS_AT)
  const start = Math.min(Math.max(startSlot, 0), SLOT_COUNT - 1)
  const end = Math.min(Math.max(endSlot, start + 1), SLOT_COUNT)
  return {
    startsAt: wallClockFromMinutes(first + start * SLOT_MINUTES),
    endsAt: wallClockFromMinutes(first + end * SLOT_MINUTES),
  }
}

/**
 * The quarter-hour slot a click landed on, as a time range one slot long.
 *
 * Clamped so a click on the last row cannot propose an end past the close of the day, which the
 * server would refuse - being unable to click the 19:45 row would be a strange way to enforce
 * closing time.
 */
export function slotAt(slot: number): { startsAt: string; endsAt: string } {
  return rangeFromSlots(slot, slot + 1)
}

/**
 * One sentence, one home. The browser says this before it sends a drag it can already see is
 * occupied; the server says the same thing when the exclusion constraint refuses one. Two copies
 * of the wording would drift apart the first time anybody improved it.
 */
export const TIME_TAKEN = 'Diese Zeit ist bei dieser Person schon belegt.'

/** The parts of an entry that decide whether something else fits beside it. */
interface Booked {
  id: string
  employeeId: string
  startsAt: string
  endsAt: string
}

/**
 * Why a proposed range cannot go where it is being dropped, in German, or null if it can.
 *
 * **The authority is the exclusion constraint, not this function.** ADR-0001 puts the no-overlap
 * rule in Postgres precisely because two saves can both read a clear slot and both write, and
 * nothing here changes that: every drag is still refused by the database if it slips past this.
 * What this buys is that a drag onto obviously occupied time costs no round trip and the box
 * never appears to land somewhere it cannot stay.
 *
 * Half-open comparison, exactly as `tsrange(starts_at, ends_at, '[)')` in the constraint:
 * 11:00-12:00 sits cleanly after 10:00-11:00, and a 15-minute grid is nothing but adjacent
 * appointments, so inclusive bounds would make every one of them a false clash.
 */
export function whyNotFree(
  booked: readonly Booked[],
  candidate: { id?: string; employeeId: string; startsAt: string; endsAt: string },
): string | null {
  const start = minutesSinceMidnight(candidate.startsAt)
  const end = minutesSinceMidnight(candidate.endsAt)

  const occupied = booked.some(
    (entry) =>
      entry.employeeId === candidate.employeeId &&
      // An entry never clashes with itself: a resize keeps most of the time it already holds.
      entry.id !== candidate.id &&
      minutesSinceMidnight(entry.startsAt) < end &&
      start < minutesSinceMidnight(entry.endsAt),
  )

  return occupied ? TIME_TAKEN : null
}

const WALL_CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Why a proposed time range cannot be booked, in German, or null if it can.
 *
 * German because it reaches the screen, and one function because the browser wants to refuse
 * a typed time before saving and the server has to refuse it again whatever the browser did.
 * Two copies of "is this bookable" would agree today and disagree in a month.
 *
 * The bookable window lives in this file and nowhere else, which is why
 * `migrations/001_init.sql` deliberately does not encode 06:00-20:00 in SQL: changing the
 * salon's hours should be an edit here, not a migration.
 */
export function whyNotBookable(startsAt: string, endsAt: string): string | null {
  if (!WALL_CLOCK.test(startsAt) || !WALL_CLOCK.test(endsAt)) {
    return 'Uhrzeit muss als HH:MM angegeben werden.'
  }

  const start = minutesSinceMidnight(startsAt)
  const end = minutesSinceMidnight(endsAt)

  if (end <= start) return 'Das Ende muss nach dem Beginn liegen.'
  if (start % SLOT_MINUTES !== 0 || end % SLOT_MINUTES !== 0) {
    return `Zeiten müssen auf einer Viertelstunde liegen (${SLOT_MINUTES}-Minuten-Raster).`
  }
  if (start < minutesSinceMidnight(DAY_STARTS_AT) || end > minutesSinceMidnight(DAY_ENDS_AT)) {
    return `Termine sind nur zwischen ${DAY_STARTS_AT} und ${DAY_ENDS_AT} möglich.`
  }

  return null
}

/** The hour labels down the side: 06:00 to 20:00 inclusive, one per hour. */
export function hourLabels(): string[] {
  const first = minutesSinceMidnight(DAY_STARTS_AT) / 60
  const last = minutesSinceMidnight(DAY_ENDS_AT) / 60
  return Array.from({ length: last - first + 1 }, (_, index) => `${String(first + index).padStart(2, '0')}:00`)
}
