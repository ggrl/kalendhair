import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'

const MIGRATIONS_DIR = 'migrations'

/**
 * Arbitrary but fixed: every process that migrates this database must use the same
 * number, or the lock guards nothing.
 */
const MIGRATION_LOCK = 48202512

/**
 * Applies every `.sql` file in `migrations/` that has not run yet, in filename order,
 * each inside its own transaction so a failure leaves nothing half-applied.
 *
 * Deliberately not a migration library. There is one file, the rule is "run the ones you
 * have not run", and a dependency would be larger than the thing it replaces.
 *
 * The advisory lock is not defensive decoration - it was added after two processes
 * migrating the same empty database at once produced
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`. Postgres
 * DDL is transactional but `CREATE TABLE IF NOT EXISTS` is not safe against a concurrent
 * creator, so "if not exists" is not the protection it reads as. Two application
 * instances starting together, which a restart on the VPS will do, hit the same thing.
 *
 * The lock is session-scoped, so every statement here runs on one checked-out client.
 */
export async function migrate(pool: Pool, log: (message: string) => void): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
    const applied = await client.query<{ filename: string }>('SELECT filename FROM schema_migration')
    const already = new Set(applied.rows.map((row) => row.filename))

    for (const filename of files) {
      if (already.has(filename)) continue

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migration (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
        log(`applied ${filename}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK])
    client.release()
  }
}
