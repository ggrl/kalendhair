import type { Day, EntryKind } from '../calendar/types'

/**
 * The browser's only way to the data. ADR-0006: the server is the only door, so everything
 * the board knows arrives through here.
 */

/** Why a write was refused, so the caller can act on it without reading German prose. */
export type RefusalCode = 'invalid' | 'clash' | 'stale' | 'gone'

export class Refused extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
  ) {
    super(message)
  }
}

export interface EntryDraft {
  employeeId: string
  kind: EntryKind
  date: string
  startsAt: string
  endsAt: string
  customer: string | null
  treatment: string | null
  notes: string | null
  /** A block only, and optional: ADR-0014. */
  reason: string | null
}

/**
 * Reads one day. No date means today in the salon's timezone, decided by the server.
 *
 * The browser must not decide it: the machine's clock is whatever the person's laptop says,
 * and a board that opens on the wrong day is the failure the timezone ruling exists to prevent.
 */
export async function fetchDay(date: string | null): Promise<Day> {
  const query = date === null ? '' : `?date=${encodeURIComponent(date)}`
  const response = await fetch(`/api/day${query}`)

  if (!response.ok) {
    // Fail loudly, and in the language on the screen. A board that silently shows an empty day
    // when the request failed is indistinguishable from a day with nothing booked, and one of
    // those is a lie.
    throw new Error(`Server antwortete mit Status ${response.status}`)
  }

  return (await response.json()) as Day
}

/**
 * Turns a refused write into something the caller can switch on.
 *
 * The `code` is what decides whether the form stays open with a message or closes because the
 * day underneath it has moved on. Matching the German sentence instead would break the moment
 * somebody improves the wording.
 */
async function refusalFrom(response: Response): Promise<Refused> {
  let code: RefusalCode = 'invalid'
  let message = `Server antwortete mit Status ${response.status}`

  try {
    const body = (await response.json()) as { error?: string; code?: RefusalCode }
    if (typeof body.error === 'string') message = body.error
    if (body.code !== undefined) code = body.code
  } catch {
    // A refusal that is not JSON is still a refusal. Keeping the status message beats throwing
    // a parsing error over the top of it and losing what actually happened.
  }

  return new Refused(code, message)
}

export async function createEntry(draft: EntryDraft): Promise<void> {
  const response = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
  if (!response.ok) throw await refusalFrom(response)
}

/** ADR-0003: the version read is sent back, and a save against a moved-on row is refused. */
export async function updateEntry(id: string, version: number, draft: EntryDraft): Promise<void> {
  const response = await fetch(`/api/entries/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...draft, version }),
  })
  if (!response.ok) throw await refusalFrom(response)
}

export async function removeEntry(id: string, version: number): Promise<void> {
  const response = await fetch(`/api/entries/${id}?version=${version}`, { method: 'DELETE' })
  if (!response.ok) throw await refusalFrom(response)
}

/**
 * What to offer while somebody types. A failure here is deliberately swallowed: autocomplete
 * is a convenience, and an empty list costs nothing, where an error over the top of a form
 * somebody is filling in costs them their place.
 */
export async function fetchSuggestions(field: 'customer' | 'treatment', query: string): Promise<string[]> {
  if (query.trim() === '') return []

  try {
    const response = await fetch(`/api/suggestions?field=${field}&q=${encodeURIComponent(query)}`)
    if (!response.ok) return []
    return (await response.json()) as string[]
  } catch {
    return []
  }
}
