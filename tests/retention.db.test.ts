import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteOlderThanAYear, startRetention } from '../server/retention.js'
import { todayIn } from '../src/calendar/salon-date.js'
import { TEST_CONFIG, addAppointment, addBlock, addEmployee, empty, testPool } from './db-helper.js'

// ADR-0027, against a real Postgres, because the line is drawn by Postgres's own interval
// arithmetic and a stub would only prove what it was told.

let pool: Pool

beforeAll(async () => {
  pool = await testPool()
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await empty(pool)
})

async function daysLeft(): Promise<string[]> {
  const result = await pool.query<{ day: string }>(
    `SELECT to_char(starts_at, 'YYYY-MM-DD') || ' ' || kind AS day FROM appointment ORDER BY starts_at`,
  )
  return result.rows.map((row) => row.day)
}

describe('deleteOlderThanAYear', () => {
  it('deletes the day before the same date last year and keeps that date itself', async () => {
    const anna = await addEmployee(pool, 'Anna', 1)
    // The last slot of the deleted day and the first slot of the kept one: the line is a date,
    // not a time of day, and nothing either side of midnight may land on the wrong side of it.
    await addAppointment(pool, anna, '2025-09-29', '19:45', '20:00', 'Kundin Alt')
    await addAppointment(pool, anna, '2025-09-30', '06:00', '06:15', 'Kundin Grenze')
    await addAppointment(pool, anna, '2026-09-30', '10:00', '11:00', 'Kundin Heute')
    await addAppointment(pool, anna, '2027-03-01', '10:00', '11:00', 'Kundin Zukunft')

    expect(await deleteOlderThanAYear(pool, '2026-09-30')).toBe(1)
    expect(await daysLeft()).toEqual(['2025-09-30 appointment', '2026-09-30 appointment', '2027-03-01 appointment'])
  })

  it('deletes blocks by the same rule', async () => {
    const anna = await addEmployee(pool, 'Anna', 1)
    await addBlock(pool, anna, '2025-09-29', '06:00', '20:00', 'Urlaub')
    await addBlock(pool, anna, '2025-09-30', '06:00', '20:00', 'Urlaub')

    expect(await deleteOlderThanAYear(pool, '2026-09-30')).toBe(1)
    expect(await daysLeft()).toEqual(['2025-09-30 block'])
  })

  it('draws the line on 28 February when today is 29 February', async () => {
    const anna = await addEmployee(pool, 'Anna', 1)
    await addAppointment(pool, anna, '2027-02-27', '10:00', '11:00', 'Kundin Alt')
    await addAppointment(pool, anna, '2027-02-28', '10:00', '11:00', 'Kundin Grenze')

    expect(await deleteOlderThanAYear(pool, '2028-02-29')).toBe(1)
    expect(await daysLeft()).toEqual(['2027-02-28 appointment'])
  })

  it('leaves every employee, including one whose appointments are all gone', async () => {
    const anna = await addEmployee(pool, 'Anna', 1)
    const left = await addEmployee(pool, 'Berta', 2, false)
    await addAppointment(pool, left, '2024-05-02', '10:00', '11:00', 'Kundin Alt')
    await addAppointment(pool, anna, '2024-05-02', '10:00', '11:00', 'Kundin Alt')

    expect(await deleteOlderThanAYear(pool, '2026-09-30')).toBe(2)
    const staff = await pool.query<{ name: string }>('SELECT name FROM employee ORDER BY position')
    expect(staff.rows.map((row) => row.name)).toEqual(['Anna', 'Berta'])
  })

  it('deletes nothing when nothing is old, and says so', async () => {
    expect(await deleteOlderThanAYear(pool, '2026-09-30')).toBe(0)
  })
})

describe('startRetention', () => {
  it('deletes on start, against the real clock, and logs a count rather than a name', async () => {
    const anna = await addEmployee(pool, 'Anna', 1)
    const today = todayIn(TEST_CONFIG.salonTimeZone, new Date())
    const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}-01-15`
    await addAppointment(pool, anna, twoYearsAgo, '10:00', '11:00', 'Kundin Alt')
    await addAppointment(pool, anna, today, '10:00', '11:00', 'Kundin Heute')

    const logged: string[] = []
    const timer = await startRetention(pool, TEST_CONFIG.salonTimeZone, (message) => logged.push(message))
    clearInterval(timer)

    expect(await daysLeft()).toEqual([`${today} appointment`])
    expect(logged).toEqual(['retention: deleted 1 appointment(s) and block(s) older than a year'])
  })
})
