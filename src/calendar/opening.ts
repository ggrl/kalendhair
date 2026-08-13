// When the salon is normally open, for shading the board and nothing else.
//
// **This changes no rule.** The bookable window is still 06:00-20:00 for everybody, every day,
// and `grid.ts` remains its only home: an appointment outside these hours is accepted without a
// murmur, because the salon books outside them and the paper page always allowed it. What this
// file buys is that the receptionist can see at a glance which part of the day is the ordinary
// working one. See ADR-0015.
//
// Imports nothing, like every file in this folder - the server and the browser resolve modules
// differently and a free-standing file pleases both. That is why the weekday is worked out here
// rather than borrowed from `dates.ts`.

/** Monday is 1 and Sunday is 7, as ISO 8601 has it. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** The hours the salon normally works, as wall clock times in its own timezone: ADR-0007. */
export interface CoreHours {
  from: string
  to: string
}

/**
 * The salon's core hours, by weekday. A day missing from here is closed all day.
 *
 * Written as data rather than as configuration on purpose: one salon, and a constant that has to
 * be edited and deployed is honest about that. It becomes configuration the day there is a second
 * salon, or the day these hours change often enough that somebody wants to do it without a
 * release.
 */
export const CORE_HOURS: Partial<Record<Weekday, CoreHours>> = {
  2: { from: '09:00', to: '18:00' },
  3: { from: '09:00', to: '18:00' },
  4: { from: '09:00', to: '18:00' },
  5: { from: '09:00', to: '18:00' },
  6: { from: '08:00', to: '13:30' },
}

/**
 * Which weekday a salon date falls on.
 *
 * Parsed as UTC midnight so no machine's timezone can move the date, which is the same reason
 * `dates.ts` does it that way. A date arrives here having passed `isSalonDate`.
 */
export function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return (day === 0 ? 7 : day) as Weekday
}

/**
 * The core hours on a given date, or null when the salon is normally closed all day.
 *
 * Sunday and Monday have no entry, so they come back null and the whole board is shaded. There is
 * no calendar of public holidays and this does not invent one: 25 December looks like an ordinary
 * Thursday, which is the same thing the paper page does.
 */
export function coreHoursOn(date: string): CoreHours | null {
  return CORE_HOURS[weekdayOf(date)] ?? null
}
