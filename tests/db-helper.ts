import { Pool } from 'pg'
import type { AppConfig } from '../server/app.js'
import { currentVersion, hashSecret, seedCredentials } from '../server/credentials.js'
import { SESSION_COOKIE, issueSession } from '../server/session.js'
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
  // `salon_credential` is deliberately not in here. It holds no test data, and re-seeding it
  // means two scrypt derives - so the row is set up once per file by the helpers below and
  // left alone, rather than rebuilt before every test in the files that call this.
  await pool.query('TRUNCATE appointment, employee CASCADE')
}

// None of the values below are secrets. They are long enough to look like the real thing and
// are written into a public repository on purpose - which is exactly why they may never be
// anything a running salon uses. `rules/secrets.md`.

export const TEST_MASTER_PASSWORD = 'test-master-password'

/** What `createApp` needs, for a test. */
export const TEST_CONFIG: AppConfig = {
  salonTimeZone: 'Europe/Berlin',
  sessionSecret: 'not-a-secret-a-published-test-signing-key',
  // Hashed once here rather than per test: scrypt is the point of this field, and paying for
  // it in every `beforeEach` would buy nothing the one derive does not already prove.
  masterPasswordHash: await hashSecret(TEST_MASTER_PASSWORD),
  // Every test speaks plain HTTP to a loopback port, and a Secure cookie would be dropped.
  cookieSecure: false,
  // Nothing sits in front of a test server, so the honest answer is the same as the default:
  // trust no forwarding header. The tests that care about the other setting pass their own.
  trustProxy: 0,
}

export const TEST_PASSWORD = 'test-salon-password'
export const TEST_PIN = '2468'

/** The credential row, seeded once if it is not there. Existing hashes are left as they are. */
export async function ensureCredentials(pool: Pool): Promise<void> {
  await seedCredentials(pool, TEST_PASSWORD, TEST_PIN)
}

/**
 * A Cookie header the app will accept, signed rather than earned through the login route.
 *
 * The version is read from the row instead of assumed to be 1, so a test file that ran after
 * one which changed the password still gets a session that counts. What the login route does
 * is proved in `auth.db.test.ts`; everywhere else, being logged in is a precondition and not
 * the thing under test.
 */
export async function sessionHeader(pool: Pool): Promise<string> {
  const version = await currentVersion(pool)
  return `${SESSION_COOKIE}=${issueSession(TEST_CONFIG.sessionSecret, version, Date.now())}`
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
