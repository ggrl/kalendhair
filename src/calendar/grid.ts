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
