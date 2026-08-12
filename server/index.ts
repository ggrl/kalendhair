import { Pool } from 'pg'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { migrate } from './migrate.js'

const config = loadConfig(process.env)
const pool = new Pool({ connectionString: config.databaseUrl })

/**
 * Without this the process exits. pg-pool emits `error` on the pool when an idle client
 * fails, and an unhandled `error` event on an EventEmitter throws - so a Postgres restart,
 * a point release, or `npm run db:down && npm run db:up` takes the API down with it, while
 * the salon is idle and nobody is watching. Proved with pg_terminate_backend during review.
 *
 * The pool discards the broken client and makes a new one on the next request, so logging
 * is the whole job here. This is not a silent fallback: the failure is recorded, and the
 * next query fails loudly on its own if the database is really gone.
 */
pool.on('error', (error) => {
  console.error('idle database connection failed, pool will replace it', error)
})

await migrate(pool, (message) => {
  console.log(`migrate: ${message}`)
})

const app = createApp(pool, config.salonTimeZone)

app.listen(config.port, config.host, () => {
  console.log(`salon calendar api on http://${config.host}:${config.port}`)
  console.log(`salon timezone: ${config.salonTimeZone}`)
  // Loud on purpose. ADR-0004 is marked to be revisited before authentication is
  // written, so nothing here checks who is asking. The bind address is the only thing
  // keeping this private, so it is printed above rather than described.
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    console.warn(`WARNING: bound to ${config.host}, which is not loopback, and there is no authentication`)
  } else {
    console.log('no authentication yet - reachable from this machine only')
  }
})
