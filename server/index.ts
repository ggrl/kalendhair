import { Pool } from 'pg'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { hashSecret, seedCredentials } from './credentials.js'
import { migrate } from './migrate.js'
import { startRetention } from './retention.js'

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

// ADR-0027: appointments and blocks older than a year are deleted, now and then daily.
await startRetention(pool, config.salonTimeZone, (message) => {
  console.log(message)
})

const app = createApp(pool, {
  salonTimeZone: config.salonTimeZone,
  sessionSecret: config.sessionSecret,
  // Hashed once here, with a salt that lives as long as this process and no longer. It is
  // never stored: the point is that each guess at the master password costs a scrypt derive,
  // exactly as a guess at the salon password does.
  masterPasswordHash: await hashSecret(config.masterPassword),
  cookieSecure: config.cookieSecure,
  trustProxy: config.trustProxy,
})

app.listen(config.port, config.host, () => {
  console.log(`salon calendar api on http://${config.host}:${config.port}`)
  console.log(`salon timezone: ${config.salonTimeZone}`)

  // Loud on purpose, and stated as a decision this process made rather than as a fact about
  // the network - because it cannot see the network. A reverse proxy terminating TLS in front
  // of a loopback bind looks exactly like stage one from in here, and that is the deployment
  // where being wrong sends the session cookie across a café wifi in clear text.
  if (config.cookieSecure) {
    console.log('session cookie: Secure - browsers will send it over HTTPS only')
    console.warn('WARNING: if nothing in front of this terminates TLS, no login will work at all')
  } else {
    console.log('session cookie: not Secure - it will travel in clear text over plain HTTP')
    console.warn('WARNING: set COOKIE_SECURE=true if anything in front of this serves the board over HTTPS')
  }

  // Said out loud for the same reason as the cookie above: this process cannot see whether a
  // proxy is really there, and being wrong either way is silent. Unset behind a proxy shares
  // one attempt budget across the internet; set with nothing in front lets a caller pick their
  // own address in a header.
  if (config.trustProxy > 0) {
    console.log(`rate limits: trusting ${config.trustProxy} proxy hop(s) for the caller's address`)
    console.warn('WARNING: if nothing in front of this is a proxy, a caller can pick their own address')
  } else {
    console.log("rate limits: using the direct connection's address, trusting no proxy header")
    console.warn('WARNING: set TRUST_PROXY=1 if a proxy serves the board, or all callers share one budget')
  }
})
