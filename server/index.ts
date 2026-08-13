import { Pool } from 'pg'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { seedCredentials } from './credentials.js'
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

// ADR-0017: the environment supplies the salon password and the PIN once, and is ignored
// afterwards. Said out loud either way, because "the password I set in .env does not work" and
// "the password I set in the screen was undone by a restart" are the two questions this
// answers, and the log is where somebody will look for them.
if (await seedCredentials(pool, config.salonPassword, config.salonPin)) {
  console.log('salon password and PIN seeded from the environment')
} else {
  console.log('salon password and PIN already set - SALON_PASSWORD and SALON_PIN are ignored')
}

const app = createApp(pool, config)

app.listen(config.port, config.host, () => {
  console.log(`salon calendar api on http://${config.host}:${config.port}`)
  console.log(`salon timezone: ${config.salonTimeZone}`)

  // Loud on purpose, and now about the thing that is actually missing. ADR-0004's deadline
  // was the first bind that is not loopback, and past that point the password travels in
  // clear text unless something in front is terminating TLS.
  if (config.cookieSecure) {
    console.warn(`WARNING: bound to ${config.host}, so the session cookie is marked Secure`)
    console.warn('WARNING: without HTTPS in front of this, no browser will send it back and nobody can log in')
  } else {
    console.log('reachable from this machine only - the session cookie is not marked Secure')
  }
})
