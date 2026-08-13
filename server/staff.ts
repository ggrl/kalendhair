import type { Pool } from 'pg'
import type { StaffMember } from '../src/calendar/types.js'
import { Refused } from './write.js'

/**
 * The staff list, and the only place that writes to `employee`.
 *
 * ADR-0018. Everything ADR-0002 decided about that table stops being theoretical here: `position`
 * is the column order and the name is not, `active` is how somebody leaves, and the foreign key
 * from `appointment` is what makes a delete safe to offer at all.
 */

/**
 * Everybody, active or not, in board order.
 *
 * The board's own query takes only the active ones; this is the list the salon manages, so it
 * has to show the people who are not on the board as well - otherwise reactivating somebody is
 * impossible from the screen that took them off it.
 */
export async function readStaff(pool: Pool): Promise<StaffMember[]> {
  const result = await pool.query<{ id: string; name: string; active: boolean; deletable: boolean }>(
    `SELECT e.id,
            e.name,
            e.active,
            NOT EXISTS (SELECT 1 FROM appointment a WHERE a.employee_id = e.id) AS deletable
       FROM employee e
      ORDER BY e.position, e.name`,
  )
  return result.rows
}

/**
 * A new stylist, at the end of the list.
 *
 * At the end because there is no answer to "where should a new person go" that is better than
 * "where you can see them", and the up and down buttons are right there.
 */
export async function addStaff(pool: Pool, name: string): Promise<{ id: string }> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO employee (name, position)
     VALUES ($1, COALESCE((SELECT max(position) FROM employee), 0) + 1)
     RETURNING id`,
    [cleanName(name)],
  )
  return result.rows[0]
}

/**
 * A rename, or a change of whether somebody is on the board.
 *
 * No version check, unlike an appointment. ADR-0003 exists because two people edit one day's
 * bookings from two machines inside one polling interval; two people renaming one stylist in the
 * same minute is not a thing that happens in a salon of six, and the cost of being wrong is a
 * name that has to be typed again rather than a customer in the wrong place.
 */
export async function updateStaff(
  pool: Pool,
  id: string,
  change: { name?: string; active?: boolean },
): Promise<void> {
  const name = change.name === undefined ? null : cleanName(change.name)
  const active = change.active ?? null

  const result = await pool.query(
    `UPDATE employee
        SET name   = COALESCE($2, name),
            active = COALESCE($3, active)
      WHERE id = $1`,
    [id, name, active],
  )
  if (result.rowCount !== 1) throw new Refused(404, 'gone', 'Diese Person gibt es nicht mehr.')
}

/**
 * One step up or down the list.
 *
 * The whole list is renumbered from 1 in the new order rather than swapping two rows' positions.
 * Swapping assumes the numbers are already distinct, and they are not: every row in this database
 * was created by hand before this screen existed, and nothing ever stopped two of them sharing a
 * position. Renumbering makes the list correct rather than assuming it already was.
 */
export async function moveStaff(pool: Pool, id: string, direction: 'up' | 'down'): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Locked, because two people pressing the arrows at once would otherwise both read the same
    // order, both renumber it, and the second one would write a list based on what it saw before
    // the first one moved anything.
    const ordered = await client.query<{ id: string }>(
      'SELECT id FROM employee ORDER BY position, name FOR UPDATE',
    )
    const ids = ordered.rows.map((row) => row.id)

    const from = ids.indexOf(id)
    if (from === -1) throw new Refused(404, 'gone', 'Diese Person gibt es nicht mehr.')

    const to = direction === 'up' ? from - 1 : from + 1
    // Silently at the end of its travel rather than a refusal: the button is disabled there, so
    // arriving here means a stale screen, and "that person is already first" is not news.
    if (to >= 0 && to < ids.length) {
      ids.splice(to, 0, ids.splice(from, 1)[0])

      // One statement, because six rows renumbered one at a time is six round trips for a click
      // somebody is watching.
      await client.query(
        `UPDATE employee AS e
            SET position = ordering.position
           FROM unnest($1::uuid[]) WITH ORDINALITY AS ordering(id, position)
          WHERE e.id = ordering.id`,
        [ids],
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Removal, for somebody who was never really here.
 *
 * ADR-0018's exception to ADR-0002, and the database is what enforces it: `appointment.employee_id`
 * is `NOT NULL REFERENCES employee (id)`, so one appointment anywhere in history refuses this. The
 * job here is to say that in a sentence rather than to check it first and hope nothing changes in
 * between - a check would be a race, and the constraint is not.
 */
export async function removeStaff(pool: Pool, id: string): Promise<void> {
  try {
    const result = await pool.query('DELETE FROM employee WHERE id = $1', [id])
    if (result.rowCount !== 1) throw new Refused(404, 'gone', 'Diese Person gibt es nicht mehr.')
  } catch (error) {
    if ((error as { code?: string }).code === '23503') {
      throw new Refused(
        409,
        'clash',
        'Diese Person hat schon Termine im Kalender und kann deshalb nicht gelöscht werden. Stattdessen deaktivieren.',
      )
    }
    throw error
  }
}

/**
 * A name that is a name.
 *
 * Trimmed rather than rejected for surrounding space, because a trailing space is a typo and not
 * a decision. Empty is refused: the board draws this at the top of a column, and a blank heading
 * is a column nobody can identify.
 */
function cleanName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Refused(400, 'invalid', 'Ohne Namen lässt sich niemand anlegen.')
  if (trimmed.length > 40) throw new Refused(400, 'invalid', 'Der Name ist zu lang für eine Spalte.')
  return trimmed
}
