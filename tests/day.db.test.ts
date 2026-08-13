import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readDay } from '../server/day.js'
import { addAppointment, addBlock, addEmployee, empty, testPool } from './db-helper.js'

const DAY = '2026-08-13'
const TZ = 'Europe/Berlin'
const NOW = new Date('2026-08-13T09:00:00Z')

let pool: Pool
let marco: string
let jana: string

beforeAll(async () => {
  pool = await testPool()
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await empty(pool)
  marco = await addEmployee(pool, 'Marco', 1)
  jana = await addEmployee(pool, 'Jana', 2)
})

describe('reading one day', () => {
  it('returns times as salon wall clock, never shifted', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'Anna Schmidt', 'Colour')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.entries).toHaveLength(1)
    expect(day.entries[0].startsAt).toBe('10:00')
    expect(day.entries[0].endsAt).toBe('11:00')
    expect(day.entries[0].customer).toBe('Anna Schmidt')
    expect(day.entries[0].treatment).toBe('Colour')
  })

  it('gives an employee with no appointments an empty column, not no column', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.employees.map((employee) => employee.name)).toEqual(['Marco', 'Jana'])
  })

  it('orders columns by position, not by name', async () => {
    await addEmployee(pool, 'Aaron', 3)

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.employees.map((employee) => employee.name)).toEqual(['Marco', 'Jana', 'Aaron'])
  })

  it('reports today in salon time rather than the machine\'s', async () => {
    // 00:30 UTC on the 14th is already 02:30 on the 14th in Berlin, but 23:30 on the
    // 13th in New York. The salon's answer is the only one that may appear.
    const day = await readDay(pool, DAY, TZ, new Date('2026-08-14T00:30:00Z'))
    expect(day.today).toBe('2026-08-14')

    const sameInstantElsewhere = await readDay(pool, DAY, 'America/New_York', new Date('2026-08-14T00:30:00Z'))
    expect(sameInstantElsewhere.today).toBe('2026-08-13')
  })

  it('leaves other days alone', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await addAppointment(pool, marco, '2026-08-14', '10:00', '11:00', 'bea')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.entries.map((entry) => entry.customer)).toEqual(['anna'])
  })
})

describe('ADR-0012: a deactivated employee leaves the board entirely', () => {
  it('drops an inactive employee with nothing booked', async () => {
    await addEmployee(pool, 'Left', 4, false)

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.employees.map((employee) => employee.name)).not.toContain('Left')
  })

  it('drops the column on a day the inactive employee has an appointment, and the appointment with it', async () => {
    // This asserted the opposite until 2026-08-13, because ADR-0002 ruled the opposite. The
    // behaviour was reversed deliberately, so the test was rewritten rather than deleted.
    const left = await addEmployee(pool, 'Left', 4, false)
    await addAppointment(pool, left, DAY, '09:00', '10:00', 'anna')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.employees.map((employee) => employee.name)).not.toContain('Left')
    // The row is still there, and no client is told about it: ADR-0012's accepted cost.
    expect(day.entries).toHaveLength(0)
  })

  it('leaves an active colleague\'s appointments on the same day alone', async () => {
    // The join must narrow the day to the hidden employee, not empty it.
    const left = await addEmployee(pool, 'Left', 4, false)
    await addAppointment(pool, left, DAY, '09:00', '10:00', 'anna')
    await addAppointment(pool, marco, DAY, '11:00', '12:00', 'bea')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.entries.map((entry) => entry.customer)).toEqual(['bea'])
    expect(day.entries.map((entry) => entry.employeeId)).toEqual([marco])
  })

  it('brings the column and the appointment back when they are reactivated', async () => {
    // Deactivating hides; it still destroys nothing, which is the half of ADR-0002 that stands.
    const left = await addEmployee(pool, 'Left', 4, false)
    await addAppointment(pool, left, DAY, '09:00', '10:00', 'anna')

    await pool.query('UPDATE employee SET active = true WHERE id = $1', [left])
    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.employees.map((employee) => employee.name)).toContain('Left')
    expect(day.entries.map((entry) => entry.customer)).toEqual(['anna'])
  })
})

describe('ADR-0009: colour says "this is the same customer"', () => {
  it('gives one customer\'s two appointments the same colour', async () => {
    // The dye case: colour sets while somebody else is cut, so one customer holds two
    // boxes with another customer's between them.
    await addAppointment(pool, marco, DAY, '09:00', '10:00', 'Anna Schmidt', 'Colour')
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'Bea Wolff', 'Cut')
    await addAppointment(pool, marco, DAY, '11:00', '12:00', 'Anna Schmidt', 'Cut and style')

    const day = await readDay(pool, DAY, TZ, NOW)
    const colourOf = (customer: string): string | null =>
      day.entries.find((entry) => entry.customer === customer)?.colour ?? null
    const anna = day.entries.filter((entry) => entry.customer === 'Anna Schmidt')

    expect(anna[0].colour).toBe(anna[1].colour)
    expect(colourOf('Bea Wolff')).not.toBe(anna[0].colour)
  })

  it('treats a stray capital or space as the same customer', async () => {
    await addAppointment(pool, marco, DAY, '09:00', '10:00', 'Anna Schmidt')
    await addAppointment(pool, jana, DAY, '09:00', '10:00', '  anna schmidt ')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.entries[0].colour).toBe(day.entries[1].colour)
  })

  it('gives blocks no colour at all', async () => {
    await addBlock(pool, marco, DAY, '12:00', '13:00')

    const day = await readDay(pool, DAY, TZ, NOW)

    expect(day.entries[0].kind).toBe('block')
    expect(day.entries[0].colour).toBeNull()
    expect(day.entries[0].customer).toBeNull()
  })
})
