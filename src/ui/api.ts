import type { Day } from '../calendar/types'

/**
 * Reads one day from the API. ADR-0006: the server is the only door to the data, so this
 * is the browser's only way in.
 *
 * No date means today in the salon's timezone, decided by the server. The browser must not
 * decide it: the machine's clock is whatever the person's laptop says, and a board that
 * opens on the wrong day is the failure the whole timezone ruling exists to prevent.
 */
export async function fetchDay(date: string | null): Promise<Day> {
  const query = date === null ? '' : `?date=${encodeURIComponent(date)}`
  const response = await fetch(`/api/day${query}`)

  if (!response.ok) {
    // Fail loudly. A board that silently shows an empty day when the request failed is
    // indistinguishable from a day with nothing booked, and one of those is a lie.
    throw new Error(`the server answered ${response.status} for ${date ?? 'today'}`)
  }

  return (await response.json()) as Day
}
