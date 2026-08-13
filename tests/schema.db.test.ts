import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addAppointment, addBlock, addEmployee, empty, testPool } from './db-helper.js'

// ADR-0001 and ADR-0008. These run against a real Postgres because the rules under test
// are enforced by the database, not by application code - a mock would only prove that
// the mock agrees with itself.

const DAY = '2026-08-13'

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

describe('no employee is in two places at once', () => {
  it('refuses an appointment overlapping another appointment', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await expect(addAppointment(pool, marco, DAY, '10:30', '11:30', 'bea')).rejects.toThrow(
      /exclusion constraint/,
    )
  })

  it('refuses an appointment fully inside another', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await expect(addAppointment(pool, marco, DAY, '10:15', '10:45', 'bea')).rejects.toThrow(
      /exclusion constraint/,
    )
  })

  it('allows the same time for a different employee', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await expect(addAppointment(pool, jana, DAY, '10:00', '11:00', 'bea')).resolves.toBeUndefined()
  })

  it('allows adjacent appointments, because the upper bound is exclusive', async () => {
    // A 15-minute grid is nothing but adjacent appointments. Inclusive bounds would make
    // every back-to-back booking a false clash, so this is the case that matters most.
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await expect(addAppointment(pool, marco, DAY, '11:00', '12:00', 'bea')).resolves.toBeUndefined()
  })

  it('allows the smallest bookable slot', async () => {
    await expect(addAppointment(pool, marco, DAY, '12:00', '12:15', 'evie')).resolves.toBeUndefined()
  })

  it('refuses moving an appointment onto a clash', async () => {
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await addAppointment(pool, jana, DAY, '10:30', '11:30', 'bea')
    await expect(
      pool.query('UPDATE appointment SET employee_id = $1 WHERE customer = $2', [marco, 'bea']),
    ).rejects.toThrow(/exclusion constraint/)
  })
})

describe('blocks are covered by the same rule as appointments', () => {
  // ADR-0008 claimed all four combinations follow from one table and one constraint.
  // That was reasoned, not run, when the ADR was written. This is the running.

  it('refuses an appointment landing on a block', async () => {
    await addBlock(pool, marco, DAY, '12:00', '13:00')
    await expect(addAppointment(pool, marco, DAY, '12:30', '13:30', 'anna')).rejects.toThrow(
      /exclusion constraint/,
    )
  })

  it('refuses a block landing on an appointment', async () => {
    await addAppointment(pool, marco, DAY, '12:00', '13:00', 'anna')
    await expect(addBlock(pool, marco, DAY, '12:30', '13:30')).rejects.toThrow(/exclusion constraint/)
  })

  it('refuses a block overlapping another block', async () => {
    await addBlock(pool, marco, DAY, '12:00', '13:00')
    await expect(addBlock(pool, marco, DAY, '12:30', '13:30')).rejects.toThrow(/exclusion constraint/)
  })

  it('refuses a whole-day block when the day already has an appointment', async () => {
    // The column-header checkbox is exactly this: one row from 06:00 to 20:00. No new
    // rule was written for it, so this test is what proves that claim.
    await addAppointment(pool, marco, DAY, '14:00', '15:00', 'anna')
    await expect(addBlock(pool, marco, DAY, '06:00', '20:00')).rejects.toThrow(/exclusion constraint/)
  })

  it('allows a whole-day block on an empty column', async () => {
    await expect(addBlock(pool, marco, DAY, '06:00', '20:00')).resolves.toBeUndefined()
  })
})

describe('the hole the exclusion constraint alone does not close', () => {
  it('refuses a zero-length row', async () => {
    // An empty range overlaps nothing, so without the positive-duration check this row
    // is accepted and stored inside an occupied hour, invisible on the board. A drag
    // that ends where it started produces exactly this.
    await addAppointment(pool, marco, DAY, '10:00', '11:00', 'anna')
    await expect(addAppointment(pool, marco, DAY, '10:30', '10:30', 'ghost')).rejects.toThrow(
      /appointment_positive_duration/,
    )
  })

  it('refuses a backwards row', async () => {
    await expect(addAppointment(pool, marco, DAY, '11:00', '10:00', 'backwards')).rejects.toThrow(
      /appointment_positive_duration/,
    )
  })

  it('refuses a row that crosses midnight', async () => {
    // The board draws one day. A row from 19:00 to 02:00 has no shape on the grid, and it
    // hides from the following day entirely because a day is selected on starts_at.
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at)
         VALUES ($1, 'block', $2::timestamp, $3::timestamp)`,
        [marco, `${DAY} 19:00`, '2026-08-14 02:00'],
      ),
    ).rejects.toThrow(/appointment_within_one_day/)
  })

  it('refuses a block spanning a week', async () => {
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at)
         VALUES ($1, 'block', $2::timestamp, $3::timestamp)`,
        [marco, '2026-08-20 06:00', '2026-08-27 20:00'],
      ),
    ).rejects.toThrow(/appointment_within_one_day/)
  })
})

describe('the two kinds stay honest', () => {
  it('refuses a block carrying a customer', async () => {
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer, treatment)
         VALUES ($1, 'block', $2::timestamp, $3::timestamp, 'anna', 'Cut')`,
        [marco, `${DAY} 12:00`, `${DAY} 13:00`],
      ),
    ).rejects.toThrow(/appointment_fields_match_kind/)
  })

  it('refuses an appointment without a customer', async () => {
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, treatment)
         VALUES ($1, 'appointment', $2::timestamp, $3::timestamp, 'Cut')`,
        [marco, `${DAY} 12:00`, `${DAY} 13:00`],
      ),
    ).rejects.toThrow(/appointment_fields_match_kind/)
  })

  it('refuses a blank or all-space customer, not only a null one', async () => {
    // The first version of this test only tried NULL and passed, so an empty name got in.
    // Every nameless box then keys to the same '' in the colour rule and they come back
    // sharing a colour, which is the false pair ADR-0009 exists to prevent.
    for (const name of ['', '   ']) {
      await expect(addAppointment(pool, marco, DAY, '12:00', '13:00', name)).rejects.toThrow(
        /appointment_fields_match_kind/,
      )
    }
  })

  it('allows an appointment with a name and no treatment yet', async () => {
    // The receptionist has a phone to their ear and a name before they have a decision.
    // Nothing in the brief or the ADRs makes treatment mandatory.
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer)
         VALUES ($1, 'appointment', $2::timestamp, $3::timestamp, 'Anna')`,
        [marco, `${DAY} 12:00`, `${DAY} 13:00`],
      ),
    ).resolves.toBeTruthy()
  })

  it('refuses a blank treatment, because that is not the same as none', async () => {
    await expect(addAppointment(pool, marco, DAY, '12:00', '13:00', 'Anna', '  ')).rejects.toThrow(
      /appointment_fields_match_kind/,
    )
  })

  it('refuses an unknown kind', async () => {
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at)
         VALUES ($1, 'holiday', $2::timestamp, $3::timestamp)`,
        [marco, `${DAY} 12:00`, `${DAY} 13:00`],
      ),
    ).rejects.toThrow(/kind/)
  })
})

describe('two saves at once', () => {
  it('lets only one of two concurrent overlapping inserts through', async () => {
    // The reason the rule is a constraint rather than a check in the application: two
    // transactions can both read a clear slot and both write. Proved here rather than
    // assumed, because everything above runs one statement at a time and would pass
    // even if the rule were only advisory.
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      await a.query('BEGIN')
      await b.query('BEGIN')

      await a.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer, treatment)
         VALUES ($1, 'appointment', $2::timestamp, $3::timestamp, 'first', 'Cut')`,
        [marco, `${DAY} 16:00`, `${DAY} 17:00`],
      )

      // b blocks here until a resolves, then fails: the constraint, not a timer.
      const second = b.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer, treatment)
         VALUES ($1, 'appointment', $2::timestamp, $3::timestamp, 'second', 'Cut')`,
        [marco, `${DAY} 16:30`, `${DAY} 17:30`],
      )

      await a.query('COMMIT')
      await expect(second).rejects.toThrow(/exclusion constraint/)
      await b.query('ROLLBACK')
    } finally {
      a.release()
      b.release()
    }

    const survivors = await pool.query<{ customer: string }>(
      'SELECT customer FROM appointment WHERE employee_id = $1',
      [marco],
    )
    expect(survivors.rows.map((row) => row.customer)).toEqual(['first'])
  })
})

describe('ADR-0014: a block may say why, and only a block', () => {
  it('accepts a block with a reason', async () => {
    await expect(addBlock(pool, marco, DAY, '12:00', '13:00', 'Urlaub')).resolves.toBeUndefined()
  })

  it('accepts a block with no reason, which is the ordinary case', async () => {
    await expect(addBlock(pool, marco, DAY, '14:00', '15:00')).resolves.toBeUndefined()
  })

  it('refuses a blank reason, because a box labelled with a space looks like a bug', async () => {
    await expect(addBlock(pool, marco, DAY, '16:00', '17:00', '   ')).rejects.toThrow(
      /appointment_fields_match_kind/,
    )
  })

  it('refuses a reason on an appointment, which has a treatment for that', async () => {
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer, reason)
         VALUES ($1, 'appointment', $2::timestamp, $3::timestamp, 'Anna Schmidt', 'Urlaub')`,
        [marco, `${DAY} 09:00`, `${DAY} 10:00`],
      ),
    ).rejects.toThrow(/appointment_fields_match_kind/)
  })

  it('still refuses a customer on a block', async () => {
    // ADR-0008's half of the rule, unchanged by ADR-0014.
    await expect(
      pool.query(
        `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer)
         VALUES ($1, 'block', $2::timestamp, $3::timestamp, 'Anna Schmidt')`,
        [marco, `${DAY} 11:00`, `${DAY} 12:00`],
      ),
    ).rejects.toThrow(/appointment_fields_match_kind/)
  })
})
