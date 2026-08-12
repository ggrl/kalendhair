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
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= SLOT_COUNT
}

/** The hour labels down the side: 06:00 to 20:00 inclusive, one per hour. */
export function hourLabels(): string[] {
  const first = minutesSinceMidnight(DAY_STARTS_AT) / 60
  const last = minutesSinceMidnight(DAY_ENDS_AT) / 60
  return Array.from({ length: last - first + 1 }, (_, index) => `${String(first + index).padStart(2, '0')}:00`)
}
