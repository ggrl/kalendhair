import { assertKnownTimeZone } from '../src/calendar/salon-date.js'

export interface Config {
  databaseUrl: string
  salonTimeZone: string
  host: string
  port: number
}

/**
 * Reads configuration and refuses to start without it. No fallback for the database or
 * the timezone: a guessed connection string fails obviously, but a guessed timezone
 * produces a board that is quietly a day out for part of every night.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = required(env, 'DATABASE_URL')
  const salonTimeZone = required(env, 'SALON_TIMEZONE')
  assertKnownTimeZone(salonTimeZone)

  // Loopback by default because this server has no authentication yet. ADR-0004 is
  // marked to be revisited before any is written, so until that happens the safe
  // default is unreachable from the network rather than open to it.
  //
  // `??` alone was a hole: it catches undefined but not `HOST=`, and Node resolves
  // listen(port, '') to `::`, which is every interface. An empty line in .env would have
  // published every customer name on the box's public address while the startup banner
  // still said loopback. Empty means unset here, exactly as it does for the values above.
  const host = env.HOST === undefined || env.HOST.trim() === '' ? '127.0.0.1' : env.HOST.trim()

  const port = Number(env.PORT ?? '3000')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT is not a usable port number: ${String(env.PORT)}`)
  }

  return { databaseUrl, salonTimeZone, host, port }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required and was not set`)
  }
  return value
}
