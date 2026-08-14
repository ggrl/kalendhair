// Shapes crossing the API boundary. Imported by the server and by the browser, so it
// imports nothing itself - the two sides resolve modules differently and a shared file
// with its own imports would have to please both.

/**
 * Where the PIN travels on a settings request. ADR-0017 and ADR-0018.
 *
 * A header, so that one guard on the server covers the reads as well as the writes and no PIN is
 * ever spelled into a URL, where every access log on the way would keep a copy. Named here
 * because both sides have to agree on it, and a string typed twice is a rule with two homes.
 */
export const PIN_HEADER = 'x-salon-pin'

/** A calendar date in the salon's own timezone, as `YYYY-MM-DD`. Never an instant. */
export type SalonDate = string

/** Wall clock time of day in the salon's timezone, as `HH:MM`. */
export type WallClock = string

export type EntryKind = 'appointment' | 'block'

/**
 * The hours the salon normally works on one day, as wall clock in its own timezone: ADR-0007.
 *
 * Lived in `opening.ts` next to the constant it described until ADR-0018 moved the hours into the
 * database. It crosses the API boundary now, which is what this file is for.
 */
export interface CoreHours {
  from: WallClock
  to: WallClock
}

/**
 * One weekday's core hours, as the settings screen reads and writes them.
 *
 * `hours` is null on a day the salon does not normally work - which the screen shows as a
 * `Geschlossen` tick, not as an empty pair of times. Two ways to say the same thing is how they
 * end up disagreeing.
 */
export interface CoreHoursDay {
  /** ISO 8601: Monday is 1 and Sunday is 7, the numbering `weekdayOf` returns. */
  weekday: number
  hours: CoreHours | null
}

export interface Employee {
  id: string
  name: string
}

/**
 * One row of the staff list the settings screen manages: ADR-0018.
 *
 * More than the board's `Employee` on purpose. The board draws the people who are on it and needs
 * nothing else; this screen is where somebody who is off it can be brought back, so it has to
 * carry the state the board filters on.
 */
export interface StaffMember extends Employee {
  active: boolean
  /**
   * Whether this row may be deleted, which is true only for somebody who has never held an entry.
   * ADR-0018's narrow exception to ADR-0002. The foreign key is the authority and refuses either
   * way; this is what stops the screen offering a button that could only ever fail.
   */
  deletable: boolean
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
  /**
   * The hours to shade this day around, or null when the salon does not normally work it.
   *
   * ADR-0018: the board draws what the server sends rather than computing it, so one source of
   * truth reaches every machine. Null covers all three reasons a day is closed - Sunday, Monday,
   * and a public holiday - because the board treats them identically and combining two rules in
   * the client is how they come apart.
   *
   * **This shades and refuses nothing.** ADR-0015 is unchanged: the full 06:00-20:00 stays
   * bookable every day, for everybody, and `grid.ts` is still the only home of that window.
   */
  coreHours: CoreHours | null
}
