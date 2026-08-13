import type { Pool } from 'pg'
import type { Day, Employee, Entry, EntryKind } from '../src/calendar/types.js'
import { assignColours } from '../src/calendar/colours.js'
import { todayIn } from '../src/calendar/salon-date.js'

interface EntryRow {
  id: string
  version: number
  employee_id: string
  kind: EntryKind
  starts_at: string
  ends_at: string
  customer: string | null
  treatment: string | null
  notes: string | null
  reason: string | null
}

/**
 * One day of the board: the columns to draw and the boxes in them.
 *
 * Times come back from Postgres already formatted by `to_char` rather than as JavaScript
 * dates. That is deliberate. `timestamp without time zone` is parsed by the driver into a
 * Date using the process timezone, which would drag the machine's clock into values that
 * ADR-0007 says are salon wall clock and nothing else. Formatting in SQL keeps them
 * strings from end to end, so no timezone can touch them.
 */
export async function readDay(pool: Pool, date: string, salonTimeZone: string, now: Date): Promise<Day> {
  // ADR-0012: a column per active employee, and nothing else. A deactivated employee is off
  // the board on every day, including the days they worked.
  const employees = await pool.query<Employee>(
    `SELECT e.id, e.name
       FROM employee e
      WHERE e.active
      -- Ties break on the id and never on the name. ADR-0002 chose position over the name
      -- for column order precisely so that renaming somebody does not move them, and with the
      -- name as the tiebreaker that promise held only while every position was distinct - which
      -- nothing enforces. A review pass renamed the middle of three rows sharing a position and
      -- watched her column move on every day of the board.
      ORDER BY e.position, e.id`,
  )

  // Joined to the same condition, not filtered afterwards, because an entry whose column is not
  // being drawn must not leave the server at all. ADR-0012 accepts that this hides an
  // appointment that still exists; what it will not have is an appointment arriving at a client
  // with nowhere to put it.
  const entries = await pool.query<EntryRow>(
    `SELECT a.id,
            a.version,
            a.employee_id,
            a.kind,
            to_char(a.starts_at, 'HH24:MI') AS starts_at,
            to_char(a.ends_at,   'HH24:MI') AS ends_at,
            a.customer,
            a.treatment,
            a.notes,
            a.reason
       FROM appointment a
       JOIN employee e ON e.id = a.employee_id
      WHERE a.starts_at::date = $1::date
        AND e.active
      ORDER BY a.starts_at, a.id`,
    [date],
  )

  // ADR-0009: computed from the whole day, on the server, so every client agrees. "The whole day"
  // is now the day the board shows: a deactivated employee's entries are not in it, so they no
  // longer take a colour out of the palette that a visible customer could have had.
  const colours = assignColours(
    entries.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      customer: row.customer,
      startsAt: row.starts_at,
    })),
  )

  return {
    date,
    today: todayIn(salonTimeZone, now),
    employees: employees.rows,
    entries: entries.rows.map((row): Entry => ({
      id: row.id,
      version: row.version,
      employeeId: row.employee_id,
      kind: row.kind,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      customer: row.customer,
      treatment: row.treatment,
      notes: row.notes,
      reason: row.reason,
      colour: colours.get(row.id) ?? null,
    })),
  }
}
