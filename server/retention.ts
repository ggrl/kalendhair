import type { Pool } from 'pg'
import { todayIn } from '../src/calendar/salon-date.js'
import { loggable } from './app.js'

/**
 * ADR-0027: nothing on the board is kept for more than a year. Appointments and blocks dated
 * before the same calendar day one year ago are deleted, and nothing else is - employees, core
 * hours and the credential row stay as they are.
 *
 * The line is the one `suggestions.ts` already draws, by the same `interval '1 year'`, so "a
 * year" means one thing in both places: from 2026-09-30 back to 2025-09-30, and from a
 * 29 February back to the 28th.
 *
 * Returns how many rows went, so the caller can log a count and never a name.
 */
export async function deleteOlderThanAYear(pool: Pool, today: string): Promise<number> {
  // Compared as dates because the line is a date, which also lets the delete use the
  // `appointment_day` index.
  const result = await pool.query(
    `DELETE FROM appointment WHERE (starts_at)::date < ($1::date - interval '1 year')::date`,
    [today],
  )
  return result.rowCount ?? 0
}

const A_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Once now, so a server that was down for a week does not wait a day to catch up, then daily.
 *
 * A failed first run rejects, and the server stops the way it does for a failed migration. A
 * failed later run is logged and retried the next day, because taking the board down over a
 * cleanup would cost the salon more than one extra day of an old appointment.
 *
 * Returns the timer, so a test can stop it.
 */
export async function startRetention(
  pool: Pool,
  salonTimeZone: string,
  log: (message: string) => void,
): Promise<NodeJS.Timeout> {
  async function run(): Promise<void> {
    const deleted = await deleteOlderThanAYear(pool, todayIn(salonTimeZone, new Date()))
    log(`retention: deleted ${deleted} appointment(s) and block(s) older than a year`)
  }

  await run()
  return setInterval(() => {
    run().catch((error: unknown) => {
      console.error('retention: delete failed, will try again in a day', loggable(error))
    })
  }, A_DAY_MS)
}
