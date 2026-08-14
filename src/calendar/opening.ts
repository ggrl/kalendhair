// When the salon is normally shut for the whole day, and which weekday a date falls on.
//
// **This changes no rule.** The bookable window is still 06:00-20:00 for everybody, every day,
// and `grid.ts` remains its only home: an appointment on Christmas Day is accepted without a
// murmur, because the salon books outside its hours and the paper page always allowed it. What
// this file buys is that the receptionist can see at a glance which part of the day is the
// ordinary working one. See ADR-0015.
//
// **The core hours used to live here and no longer do.** ADR-0018 moved them into `core_hours`
// in the database so the settings screen can change them without a release, which is the exact
// condition ADR-0015 named when it wrote them down as a constant. The holidays stay put -
// ADR-0016 - so this file has one foot on each side, and ADR-0018 says what to do if that ever
// reads badly: the holidays follow the hours and ADR-0016 gets a successor.
//
// Imports nothing, like every file in this folder - the server and the browser resolve modules
// differently and a free-standing file pleases both. That is why the weekday is worked out here
// rather than borrowed from `dates.ts`.

/** Monday is 1 and Sunday is 7, as ISO 8601 has it. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Hessen's public holidays, fetched from `feiertage-api.de` for 2026 to 2030 and checked against
 * the Easter arithmetic before being written down: Christi Himmelfahrt is Easter plus 39 days,
 * Pfingstmontag plus 50, Fronleichnam plus 60, and all five years agree. Hessen's set has
 * Fronleichnam and does not have Reformationstag or Allerheiligen.
 *
 * A list and not a request: ADR-0016. The board's colours must not depend on somebody else's
 * server being up, and a salon that cannot see which day is a holiday because an API is down is
 * worse off than one reading a wrong colour.
 *
 * The names are data rather than comments because the top bar shows them: a whole board washed
 * pink otherwise leaves somebody wondering whether the salon is shut or the software is broken.
 *
 * **This list runs out.** `tests/opening.test.ts` fails a year before it does, with the URL to
 * refresh it from - that tripwire is the only thing standing between the last date here and a
 * board that quietly stops marking holidays.
 */
const HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-01-01': 'Neujahrstag',
  '2026-04-03': 'Karfreitag',
  '2026-04-06': 'Ostermontag',
  '2026-05-01': 'Tag der Arbeit',
  '2026-05-14': 'Christi Himmelfahrt',
  '2026-05-25': 'Pfingstmontag',
  '2026-06-04': 'Fronleichnam',
  '2026-10-03': 'Tag der Deutschen Einheit',
  '2026-12-25': '1. Weihnachtstag',
  '2026-12-26': '2. Weihnachtstag',

  '2027-01-01': 'Neujahrstag',
  '2027-03-26': 'Karfreitag',
  '2027-03-29': 'Ostermontag',
  '2027-05-01': 'Tag der Arbeit',
  '2027-05-06': 'Christi Himmelfahrt',
  '2027-05-17': 'Pfingstmontag',
  '2027-05-27': 'Fronleichnam',
  '2027-10-03': 'Tag der Deutschen Einheit',
  '2027-12-25': '1. Weihnachtstag',
  '2027-12-26': '2. Weihnachtstag',

  '2028-01-01': 'Neujahrstag',
  '2028-04-14': 'Karfreitag',
  '2028-04-17': 'Ostermontag',
  '2028-05-01': 'Tag der Arbeit',
  '2028-05-25': 'Christi Himmelfahrt',
  '2028-06-05': 'Pfingstmontag',
  '2028-06-15': 'Fronleichnam',
  '2028-10-03': 'Tag der Deutschen Einheit',
  '2028-12-25': '1. Weihnachtstag',
  '2028-12-26': '2. Weihnachtstag',

  '2029-01-01': 'Neujahrstag',
  '2029-03-30': 'Karfreitag',
  '2029-04-02': 'Ostermontag',
  '2029-05-01': 'Tag der Arbeit',
  '2029-05-10': 'Christi Himmelfahrt',
  '2029-05-21': 'Pfingstmontag',
  '2029-05-31': 'Fronleichnam',
  '2029-10-03': 'Tag der Deutschen Einheit',
  '2029-12-25': '1. Weihnachtstag',
  '2029-12-26': '2. Weihnachtstag',

  '2030-01-01': 'Neujahrstag',
  '2030-04-19': 'Karfreitag',
  '2030-04-22': 'Ostermontag',
  '2030-05-01': 'Tag der Arbeit',
  '2030-05-30': 'Christi Himmelfahrt',
  '2030-06-10': 'Pfingstmontag',
  '2030-06-20': 'Fronleichnam',
  '2030-10-03': 'Tag der Deutschen Einheit',
  '2030-12-25': '1. Weihnachtstag',
  '2030-12-26': '2. Weihnachtstag',
}

/**
 * The last date the holiday list can speak for. Everything after this is treated as an ordinary
 * day, which is why a test watches this value against the clock.
 */
export const HOLIDAYS_COVERED_THROUGH = '2030-12-31'

/** Where to get the next five years when the list runs out. `nur_land=HE` is Hessen. */
export const HOLIDAY_SOURCE = 'https://feiertage-api.de/api/?jahr=YYYY&nur_land=HE'

/**
 * The German name of the Hessen public holiday on this date, or null if it is not one.
 *
 * The name is what the top bar shows. A board shaded from 06:00 to 20:00 with nothing saying why
 * is the same shape of problem as a photograph: correct, and unreadable to whoever is holding it.
 */
export function holidayName(date: string): string | null {
  return HOLIDAYS[date] ?? null
}

/** Whether a date is a Hessen public holiday, as far as the list reaches. */
export function isHoliday(date: string): boolean {
  return holidayName(date) !== null
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
