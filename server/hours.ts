import type { Pool } from 'pg'
import type { CoreHours, CoreHoursDay } from '../src/calendar/types.js'
import { germanWeekday } from '../src/calendar/dates.js'
import { isHoliday, weekdayOf } from '../src/calendar/opening.js'
import { DAY_ENDS_AT, DAY_STARTS_AT, SLOT_MINUTES, minutesSinceMidnight } from '../src/calendar/grid.js'
import { Refused } from './write.js'

/**
 * The salon's core hours, and the only place that reads or writes `core_hours`.
 *
 * ADR-0018 moved these out of a constant in `src/calendar/opening.ts` so the settings screen can
 * change them without a release. ADR-0015 still decides what they mean, and it has not moved:
 * **they colour the board and refuse nothing.** The bookable window is 06:00-20:00 every day for
 * everybody and lives in `grid.ts`, which is also what these times are checked against - the
 * board cannot draw a band outside the grid it is drawing on.
 */

/** How many rows a week has. Seven, and the table's primary key check says so too. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

interface HoursRow {
  weekday: number
  from: string | null
  to: string | null
}

/**
 * The whole week, Monday first, for the settings screen.
 *
 * Times come back formatted by `to_char` rather than as anything the driver has interpreted, the
 * same rule `day.ts` follows: these are salon wall clock and no machine's timezone may touch
 * them on the way out. ADR-0007.
 */
export async function readWeek(pool: Pool): Promise<CoreHoursDay[]> {
  const result = await pool.query<HoursRow>(
    `SELECT weekday,
            to_char(opens_at,  'HH24:MI') AS "from",
            to_char(closes_at, 'HH24:MI') AS "to"
       FROM core_hours
      ORDER BY weekday`,
  )
  return result.rows.map(asDay)
}

/**
 * The hours to shade one date around, or null when the salon does not normally work it.
 *
 * Null for three reasons the board treats identically, because they mean the same thing to
 * somebody looking at it: Sunday, Monday, and a Hessen public holiday. The holiday check is here
 * rather than in the client so that `Day.coreHours` is one answer and not two rules a client has
 * to combine - ADR-0016 keeps the list itself in the code.
 */
export async function hoursOn(pool: Pool, date: string): Promise<CoreHours | null> {
  if (isHoliday(date)) return null

  const result = await pool.query<HoursRow>(
    `SELECT weekday,
            to_char(opens_at,  'HH24:MI') AS "from",
            to_char(closes_at, 'HH24:MI') AS "to"
       FROM core_hours
      WHERE weekday = $1`,
    [weekdayOf(date)],
  )
  return result.rows[0] === undefined ? null : asDay(result.rows[0]).hours
}

/**
 * A whole week at once, in one transaction.
 *
 * All seven or none, which is what the owner chose: somebody sits down once a year, fixes the
 * hours and presses one button, and a half-written week is a state nobody asked for and the
 * screen would have to explain. It also means a refusal on Saturday cannot leave Tuesday changed.
 *
 * `UPDATE` and not an upsert: the seven rows exist from the migration onward, and a week arriving
 * with a weekday the table does not have is a malformed request rather than a row to create.
 */
export async function writeWeek(pool: Pool, week: unknown): Promise<void> {
  const days = validWeek(week)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const day of days) {
      await client.query('UPDATE core_hours SET opens_at = $2, closes_at = $3 WHERE weekday = $1', [
        day.weekday,
        day.hours?.from ?? null,
        day.hours?.to ?? null,
      ])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** A row as the API shape. A closed day is one null, not a pair of them. */
function asDay(row: HoursRow): CoreHoursDay {
  // `to_char` of NULL is NULL, and the table's own check makes both null together - so testing
  // one is testing both, and the constraint is what makes that safe to say.
  const hours = row.from === null || row.to === null ? null : { from: row.from, to: row.to }
  return { weekday: row.weekday, hours }
}

/**
 * A week that can be drawn, or a German sentence naming the weekday that cannot.
 *
 * Validated at the boundary, where data arrives from a person: `rules/coding-standards.md`
 * section C. The table repeats the structural half of this and cannot repeat the rest, because
 * 06:00-20:00 deliberately is not in SQL - `grid.ts` owns that window and a copy of it in a
 * constraint would be a second place for it to disagree with itself.
 */
function validWeek(week: unknown): CoreHoursDay[] {
  if (!Array.isArray(week) || week.length !== WEEKDAYS.length) {
    throw new Refused(400, 'invalid', 'Es müssen alle sieben Wochentage geschickt werden.')
  }

  const days = week.map(validDay)

  const seen = new Set(days.map((day) => day.weekday))
  if (seen.size !== WEEKDAYS.length || WEEKDAYS.some((weekday) => !seen.has(weekday))) {
    throw new Refused(400, 'invalid', 'Es müssen alle sieben Wochentage geschickt werden.')
  }

  return days
}

function validDay(value: unknown): CoreHoursDay {
  const day = value as { weekday?: unknown; hours?: unknown }

  if (typeof day?.weekday !== 'number' || !WEEKDAYS.includes(day.weekday)) {
    throw new Refused(400, 'invalid', 'Es müssen alle sieben Wochentage geschickt werden.')
  }

  // Closed, and the only way to say it. A day with no times is not the same request as a day
  // with two times that happen to be equal, which is refused below.
  if (day.hours === null || day.hours === undefined) {
    return { weekday: day.weekday, hours: null }
  }

  const hours = day.hours as { from?: unknown; to?: unknown }
  const name = germanWeekday(day.weekday)

  if (typeof hours?.from !== 'string' || typeof hours?.to !== 'string') {
    throw new Refused(400, 'invalid', `${name}: Uhrzeit muss als HH:MM angegeben werden.`)
  }

  const unusable = whyUnusable(hours.from) ?? whyUnusable(hours.to)
  if (unusable !== null) throw new Refused(400, 'invalid', `${name}: ${unusable}`)

  // Equal times are refused rather than read as a closed day. Somebody who wants Saturday shut
  // has a tick that says so, and silently turning 09:00 to 09:00 into "closed" would throw away
  // what they typed with nothing on screen saying it happened.
  if (minutesSinceMidnight(hours.to) <= minutesSinceMidnight(hours.from)) {
    throw new Refused(400, 'invalid', `${name}: Das Ende muss nach dem Beginn liegen.`)
  }

  return { weekday: day.weekday, hours: { from: hours.from, to: hours.to } }
}

const WALL_CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Why one time cannot be a core hour, in German, or null if it can.
 *
 * The quarter-hour rule is not tidiness: the board is a grid of 15-minute rows, so 09:07 cannot
 * be drawn where it says. Rounding it to a row would leave the number on the settings screen and
 * the band on the board quietly disagreeing, which is worse than refusing it.
 */
function whyUnusable(wallClock: string): string | null {
  if (!WALL_CLOCK.test(wallClock)) return 'Uhrzeit muss als HH:MM angegeben werden.'

  const minutes = minutesSinceMidnight(wallClock)

  if (minutes % SLOT_MINUTES !== 0) {
    return `Zeiten müssen auf einer Viertelstunde liegen (${SLOT_MINUTES}-Minuten-Raster).`
  }
  if (minutes < minutesSinceMidnight(DAY_STARTS_AT) || minutes > minutesSinceMidnight(DAY_ENDS_AT)) {
    return `Kernzeiten sind nur zwischen ${DAY_STARTS_AT} und ${DAY_ENDS_AT} möglich.`
  }

  return null
}
