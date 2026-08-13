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

/**
 * Nobody is logged in, or the session ended - because it ran out, or because the salon
 * password changed and ADR-0017 says that logs everybody out.
 *
 * Its own type rather than a status code the caller has to remember, because the board's
 * answer to it is the one thing it must not confuse with a failed load: a login screen, not
 * "Laden fehlgeschlagen".
 */
export class Unauthenticated extends Error {}

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

  if (response.status === 401) throw new Unauthenticated('Bitte anmelden.')

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
async function refusalFrom(response: Response): Promise<Error> {
  // Before anything else, because a 401 is not a refusal to be shown in a form. The server
  // sends it with no `code`, so it used to arrive as `invalid` - which the form treats as
  // "fix this field and try again", over a board the server has stopped answering for. A
  // review pass walked into it: save, get "Bitte anmelden." in red inside the dialogue, and
  // no way out of it that reaches the login screen.
  if (response.status === 401) return new Unauthenticated('Bitte anmelden.')

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
 * The salon password, exchanged for the session cookie the server sets. ADR-0004.
 *
 * Nothing is stored here: the cookie is httpOnly, so this code cannot read it and neither can
 * anything else that ends up on the page. Whether somebody is logged in is answered by asking
 * the server for a day, which is the only question that matters.
 */
export async function login(password: string): Promise<void> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) throw new Error(await messageFrom(response))
}

/** ADR-0017: the master password sets a new salon password and a new PIN, and gets no session. */
export async function resetCredentials(master: string, password: string, pin: string): Promise<void> {
  const response = await fetch('/api/credentials/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ master, password, pin }),
  })
  if (!response.ok) throw new Error(await messageFrom(response))
}

/** The server's German sentence, or the status if it did not send one. */
async function messageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (typeof body.error === 'string') return body.error
  } catch {
    // Not JSON. The status is still the truth about what happened.
  }
  return `Server antwortete mit Status ${response.status}`
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
