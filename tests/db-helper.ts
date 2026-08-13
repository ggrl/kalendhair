import { Pool } from 'pg'
import { migrate } from '../server/migrate.js'

/**
 * A pool against the test database, migrated and emptied.
 *
 * TEST_DATABASE_URL is required rather than falling back to DATABASE_URL. These tests
 * truncate tables, and a fallback would eventually empty the database somebody was
 * working in - the kind of loss that cannot be undone by running the tests again.
 */
export async function testPool(): Promise<Pool> {
  const connectionString = process.env.TEST_DATABASE_URL
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new Error(
      'TEST_DATABASE_URL is required for database tests.\n' +
        'Vitest does not read .env into process.env, so pass it explicitly:\n' +
        '  npm run db:up\n' +
        '  export $(grep TEST_DATABASE_URL .env) && npm run test:db',
    )
  }

  // These tests TRUNCATE. Refusing to run against a database whose name does not say it
  // is for tests is the difference between a wrong export costing a rerun and it costing
  // the salon's appointment book, which nothing brings back.
  // Parsed the way `pg` parses it, not by splitting on '/'. Splitting kept a URL fragment,
  // so `postgres://host/salon#_test` passed the check while the driver connected to
  // `salon` - and then TRUNCATE ran against the salon's real book. Contrived to type by
  // accident, unrecoverable if it happened.
  const database = new URL(connectionString).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL points at "${database}", which is not a database whose name ends in _test. ` +
        'These tests empty every table, so they refuse to run against anything else.',
    )
  }

  const pool = new Pool({ connectionString })
  await migrate(pool, () => {})
  return pool
}

export async function empty(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE appointment, employee CASCADE')
}

export async function addEmployee(pool: Pool, name: string, position: number, active = true): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO employee (name, position, active) VALUES ($1, $2, $3) RETURNING id',
    [name, position, active],
  )
  return result.rows[0].id
}

export async function addAppointment(
  pool: Pool,
  employeeId: string,
  day: string,
  from: string,
  to: string,
  customer: string,
  treatment = 'Cut',
): Promise<void> {
  await pool.query(
    `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, customer, treatment)
     VALUES ($1, 'appointment', $2::timestamp, $3::timestamp, $4, $5)`,
    [employeeId, `${day} ${from}`, `${day} ${to}`, customer, treatment],
  )
}

export async function addBlock(
  pool: Pool,
  employeeId: string,
  day: string,
  from: string,
  to: string,
  reason: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO appointment (employee_id, kind, starts_at, ends_at, reason)
     VALUES ($1, 'block', $2::timestamp, $3::timestamp, $4)`,
    [employeeId, `${day} ${from}`, `${day} ${to}`, reason],
  )
}
