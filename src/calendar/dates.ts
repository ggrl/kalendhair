// ADR-0010. Date arithmetic for navigation and the week number in the header. Both halves
// have a wrong answer that passes casual testing, which is why they are settled in one
// place and tested against fixed boundary dates rather than a comfortable mid-year one.
//
// Imports nothing, like the rest of `src/calendar`: the server and the browser resolve
// modules differently and a free-standing file pleases both.

/** Days are plain `YYYY-MM-DD`. Parsed as UTC so no local timezone can shift a date. */
function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function format(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const shifted = toUtc(date)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return format(shifted)
}

/**
 * A week step keeps the weekday. That is the whole point of the feature: a customer asking
 * for the same slot in four weeks is four clicks and the same Thursday.
 */
export function addWeeks(date: string, weeks: number): string {
  return addDays(date, weeks * 7)
}

/**
 * A month step keeps the day of the month, clamped to the last day of a shorter month.
 *
 * **Not reversible, and that is accepted rather than solved.** Forward from 31 January
 * lands on 28 February; back from there lands on 28 January. Remembering the original day
 * across clicks would make the button's behaviour depend on invisible history, which is
 * worse than a step that does not perfectly undo.
 */
export function addMonths(date: string, months: number): string {
  const start = toUtc(date)
  const targetMonth = start.getUTCMonth() + months
  const year = start.getUTCFullYear() + Math.floor(targetMonth / 12)
  const month = ((targetMonth % 12) + 12) % 12

  // Day 0 of the following month is the last day of this one.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(start.getUTCDate(), lastDayOfTarget)

  return format(new Date(Date.UTC(year, month, day)))
}

export interface IsoWeek {
  week: number
  /**
   * The ISO week-year, which is **not** always the year in the date. 1 January 2027 falls
   * in week 53 of 2026. Anything deriving the week from the calendar year is wrong for six
   * days each time a year turns over on the wrong weekday.
   */
  weekYear: number
}

/**
 * ISO 8601 week number. Weeks run Monday to Sunday, and week 1 is the week containing
 * 4 January - equivalently, the week containing the first Thursday of January.
 *
 * The implementation moves to the Thursday of the date's own week and asks which year that
 * Thursday is in. That is what makes the week-year come out right at a year boundary, and
 * it is the reason this is a function rather than arithmetic inlined at the call site.
 */
export function isoWeek(date: string): IsoWeek {
  const thursday = toUtc(date)

  // getUTCDay is 0 for Sunday; ISO wants 7, so Monday is 1 and Sunday is 7.
  const isoDayOfWeek = thursday.getUTCDay() === 0 ? 7 : thursday.getUTCDay()
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoDayOfWeek)

  const weekYear = thursday.getUTCFullYear()
  const firstOfWeekYear = Date.UTC(weekYear, 0, 1)
  const daysIntoYear = (thursday.getTime() - firstOfWeekYear) / 86_400_000

  return { week: Math.ceil((daysIntoYear + 1) / 7), weekYear }
}

/**
 * The header line, in German, formatted the German way: "Donnerstag, 13. August 2026".
 *
 * Built from the date string in UTC rather than from a local Date, so the label always
 * names the day that was asked for. Formatting a date near midnight through the machine's
 * timezone is how a calendar ends up captioning the wrong day.
 */
export function longGermanDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtc(date))
}
