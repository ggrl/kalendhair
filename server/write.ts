import type { Pool } from 'pg'
import type { EntryKind } from '../src/calendar/types.js'
import { isSalonDate } from '../src/calendar/salon-date.js'
import { whyNotBookable } from '../src/calendar/grid.js'

/**
 * Creating, changing and removing entries.
 *
 * Every refusal here is a German sentence naming the one rule that was broken. ADR-0001 says
 * a constraint violation surfaces as a Postgres error naming a constraint, and that the server
 * has to turn it into something a receptionist can read - and has to tell an overlap apart
 * from a zero-length drag, because they are different mistakes.
 */

export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface EntryInput {
  employeeId: string
  kind: EntryKind
  date: string
  startsAt: string
  endsAt: string
  customer: string | null
  treatment: string | null
  notes: string | null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Validates at the boundary, where data arrives from a person and is not yet known good -
 * `rules/coding-standards.md` section C. Past this, the rest of the module can stop checking.
 *
 * The database enforces all of this again, and that is not duplication of a rule but of a
 * check: the constraint is the enforcement, this is the readable refusal. A save that reaches
 * Postgres and comes back with a constraint name has already lost the chance to say something
 * useful about which field was wrong.
 */
export function parseEntryInput(body: unknown): EntryInput {
  if (typeof body !== 'object' || body === null) throw new Refused(400, 'Ungültige Anfrage.')
  const raw = body as Record<string, unknown>

  const employeeId = text(raw.employeeId)
  if (employeeId === null) throw new Refused(400, 'Es fehlt die Person, für die der Termin gilt.')

  const kind: EntryKind = raw.kind === 'block' ? 'block' : 'appointment'
  if (raw.kind !== 'block' && raw.kind !== 'appointment') {
    throw new Refused(400, 'Unbekannte Art von Eintrag.')
  }

  const date = text(raw.date)
  if (date === null || !isSalonDate(date)) throw new Refused(400, 'Ungültiges Datum.')

  const startsAt = text(raw.startsAt) ?? ''
  const endsAt = text(raw.endsAt) ?? ''
  const unbookable = whyNotBookable(startsAt, endsAt)
  if (unbookable !== null) throw new Refused(400, unbookable)

  const customer = text(raw.customer)
  const treatment = text(raw.treatment)
  const notes = text(raw.notes)

  if (kind === 'block') {
    // ADR-0008: a block is a grey area with no text. Silently dropping the fields would be a
    // silent fallback; saying so is one sentence.
    if (customer !== null || treatment !== null || notes !== null) {
      throw new Refused(400, 'Eine Sperrzeit hat keine Kundin, keine Behandlung und keine Notiz.')
    }
  } else if (customer === null) {
    throw new Refused(400, 'Ohne Namen lässt sich der Termin nicht speichern.')
  }

  return { employeeId, kind, date, startsAt, endsAt, customer, treatment, notes }
}

interface DatabaseError {
  code?: string
  constraint?: string
}

/**
 * One Postgres failure becomes one sentence about one rule.
 *
 * `23P01` is an exclusion violation, which here can only be the no-overlap constraint.
 * `23514` is a check violation, told apart by the constraint's name. `23503` is the foreign
 * key, which means the employee does not exist.
 */
function refusalFor(error: unknown): Refused | null {
  const database = error as DatabaseError
  if (database.code === '23P01') {
    return new Refused(409, 'Diese Zeit ist bei dieser Person schon belegt.')
  }
  if (database.code === '23503') {
    return new Refused(400, 'Diese Person gibt es nicht.')
  }
  if (database.code === '23514') {
    switch (database.constraint) {
      case 'appointment_positive_duration':
        return new Refused(400, 'Das Ende muss nach dem Beginn liegen.')
      case 'appointment_within_one_day':
        return new Refused(400, 'Ein Eintrag darf nicht über Mitternacht gehen.')
      case 'appointment_fields_match_kind':
        return new Refused(400, 'Termin und Sperrzeit haben unterschiedliche Felder.')
      default:
        return null
    }
  }
  return null
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const refusal = refusalFor(error)
    // Rethrow anything unrecognised. Turning an unknown database failure into a friendly
    // sentence would hide a real fault behind a message about booking rules.
    if (refusal === null) throw error
    throw refusal
  }
}

export async function createEntry(pool: Pool, input: EntryInput): Promise<{ id: string }> {
  return guarded(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer, treatment, notes)
       VALUES ($1, $2, ($3 || ' ' || $4)::timestamp, ($3 || ' ' || $5)::timestamp, $6, $7, $8)
       RETURNING id`,
      [
        input.employeeId,
        input.kind,
        input.date,
        input.startsAt,
        input.endsAt,
        input.customer,
        input.treatment,
        input.notes,
      ],
    )
    return { id: result.rows[0].id }
  })
}

/**
 * ADR-0003. The version read is part of the WHERE clause, so a save against a row somebody
 * else has already changed matches nothing and affects no rows. That is the whole mechanism:
 * one condition, and an honest message when it matches nothing.
 */
export async function updateEntry(
  pool: Pool,
  id: string,
  version: number,
  input: EntryInput,
): Promise<{ version: number }> {
  return guarded(async () => {
    const result = await pool.query<{ version: number }>(
      `UPDATE appointment
          SET employee_id = $3,
              kind        = $4,
              starts_at   = ($5 || ' ' || $6)::timestamp,
              ends_at     = ($5 || ' ' || $7)::timestamp,
              customer    = $8,
              treatment   = $9,
              notes       = $10,
              version     = version + 1
        WHERE id = $1 AND version = $2
      RETURNING version`,
      [
        id,
        version,
        input.employeeId,
        input.kind,
        input.date,
        input.startsAt,
        input.endsAt,
        input.customer,
        input.treatment,
        input.notes,
      ],
    )

    if (result.rowCount === 0) throw await whyItMissed(pool, id)
    return { version: result.rows[0].version }
  })
}

export async function removeEntry(pool: Pool, id: string, version: number): Promise<void> {
  const result = await pool.query('DELETE FROM appointment WHERE id = $1 AND version = $2', [id, version])
  // Deleting is version-checked for the same reason saving is: if somebody moved the
  // appointment since it was read, the row being deleted is not the one that was on screen.
  if (result.rowCount === 0) throw await whyItMissed(pool, id)
}

/**
 * Tells "somebody changed it" apart from "it is not there any more", because they need
 * different sentences: one asks you to look again, the other says there is nothing left to
 * look at. Both are the same refusal to the rule, and quite different to the person reading it.
 *
 * The extra query runs only on the failing path, which is rare by construction.
 */
async function whyItMissed(pool: Pool, id: string): Promise<Refused> {
  const stillThere = await pool.query('SELECT 1 FROM appointment WHERE id = $1', [id])
  if (stillThere.rowCount === 0) {
    return new Refused(409, 'Dieser Eintrag wurde inzwischen gelöscht.')
  }
  return new Refused(409, 'Der Eintrag wurde inzwischen geändert. Bitte den Tag neu laden.')
}
