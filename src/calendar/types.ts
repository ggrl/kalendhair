// Shapes crossing the API boundary. Imported by the server and by the browser, so it
// imports nothing itself - the two sides resolve modules differently and a shared file
// with its own imports would have to please both.

/** A calendar date in the salon's own timezone, as `YYYY-MM-DD`. Never an instant. */
export type SalonDate = string

/** Wall clock time of day in the salon's timezone, as `HH:MM`. */
export type WallClock = string

export type EntryKind = 'appointment' | 'block'

export interface Employee {
  id: string
  name: string
}

/**
 * One box on the board. The kind is what the client switches on rather than guessing from
 * null fields: an appointment carries a customer, a treatment and notes; a block carries a
 * reason and nothing else, and renders grey.
 */
export interface Entry {
  id: string
  /**
   * ADR-0003. The client sends this back with any change, and a save against a version the
   * database has already moved past is refused rather than applied. Without it on the read
   * side there is no way to make that check, so it is part of an entry, not an extra.
   */
  version: number
  employeeId: string
  kind: EntryKind
  startsAt: WallClock
  endsAt: WallClock
  customer: string | null
  treatment: string | null
  notes: string | null
  /**
   * Why this time is blocked, for a block only, and optional. ADR-0014: it is drawn on the box
   * on the box after the `N/A` marker, which is the opposite of what `notes` does - hence its own
   * field rather than one column with two visibility rules.
   */
  reason: string | null
  /**
   * Assigned by the server from the whole day, never stored, and null for blocks.
   * ADR-0009: two boxes share a colour only if they are the same customer, so the
   * client must not derive this itself or it will disagree with other clients.
   */
  colour: string | null
}

/** Everything one screen of the board needs, in one response. */
export interface Day {
  date: SalonDate
  /** Today in the salon's timezone, so the client never asks the device what day it is. */
  today: SalonDate
  employees: Employee[]
  entries: Entry[]
}
