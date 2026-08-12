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
