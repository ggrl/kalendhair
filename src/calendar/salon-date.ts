// ADR-0007: the salon's own calendar date, never an absolute instant and never the
// device's idea of today. Imports nothing, for the same reason as `colours.ts`.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * True only for a real `YYYY-MM-DD`. Rejects 2026-02-30 as well as malformed input,
 * because `new Date('2026-02-30')` silently rolls forward to March and a silently
 * wrong day is the failure this whole product is trying to avoid.
 */
export function isSalonDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (match === null) return false

  const [, year, month, day] = match

  // Years below 1000 are refused, which closes two problems at once.
  //
  // JavaScript has a year zero and Postgres does not - it runs 1 BC straight to 1 AD - so
  // `0000-01-01` used to reach the database and come back as a server error from a
  // validator claiming to be complete.
  //
  // Two-digit years are worse, because they fail silently rather than loudly:
  // `Date.UTC(50, 0, 1)` means 1950, not year 50, so `isoWeek('0050-03-15')` returned
  // `KW -99126` and `addMonths('0050-01-31', 1)` returned `1950-02-28`. Rather than patch
  // each function, the boundary refuses the whole family. Nothing books an appointment in
  // the first millennium, and everything downstream may now assume a four-digit year.
  if (Number(year) < 1000) return false

  const asUtc = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (Number.isNaN(asUtc.getTime())) return false

  // Round-trip: if the day rolled over, the input named a date that does not exist.
  return asUtc.toISOString().slice(0, 10) === value
}

/**
 * Today as the salon reckons it. The timezone is configuration, never inferred: a
 * container's clock is normally UTC, so asking the machine what day it is gives the
 * wrong answer for several hours every night.
 */
export function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const find = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)
    // Intl always supplies the parts it was asked for. If that ever stops being true,
    // failing here is better than returning a plausible-looking wrong date.
    if (part === undefined) throw new Error(`Intl did not return a ${type} part for ${timeZone}`)
    return part.value
  }

  return `${find('year')}-${find('month')}-${find('day')}`
}

/** Throws unless the timezone is one this runtime knows. Called at startup, not per request. */
export function assertKnownTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone })
  } catch {
    throw new Error(`SALON_TIMEZONE is not a timezone this runtime knows: ${timeZone}`)
  }
}
