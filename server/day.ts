import type { Pool } from 'pg'
import type { Day, Employee, Entry, EntryKind } from '../src/calendar/types.js'
import { assignColours } from '../src/calendar/colours.js'
import { todayIn } from '../src/calendar/salon-date.js'

interface EntryRow {
  id: string
  employee_id: string
  kind: EntryKind
  starts_at: string
  ends_at: string
  customer: string | null
  treatment: string | null
  notes: string | null
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
  // ADR-0002: a deactivated employee keeps their column on any day they have entries, so
  // past days still read correctly. Active staff always get one.
  const employees = await pool.query<Employee>(
    `SELECT e.id, e.name
       FROM employee e
      WHERE e.active
         OR EXISTS (
              SELECT 1 FROM appointment a
               WHERE a.employee_id = e.id AND a.starts_at::date = $1::date
            )
      ORDER BY e.position, e.name`,
    [date],
  )

  const entries = await pool.query<EntryRow>(
    `SELECT id,
            employee_id,
            kind,
            to_char(starts_at, 'HH24:MI') AS starts_at,
            to_char(ends_at,   'HH24:MI') AS ends_at,
            customer,
            treatment,
            notes
       FROM appointment
      WHERE starts_at::date = $1::date
      ORDER BY starts_at, id`,
    [date],
  )

  // ADR-0009: computed from the whole day, on the server, so every client agrees.
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
      employeeId: row.employee_id,
      kind: row.kind,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      customer: row.customer,
      treatment: row.treatment,
      notes: row.notes,
      colour: colours.get(row.id) ?? null,
    })),
  }
}
