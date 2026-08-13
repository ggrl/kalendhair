import { describe, expect, it } from 'vitest'
import { loadConfig } from '../server/config.js'

// None of these are secrets, and none may ever be used by a running salon: they are in a
// public repository. `rules/secrets.md`.
const complete = {
  DATABASE_URL: 'postgres://salon@127.0.0.1:5432/salon',
  SALON_TIMEZONE: 'Europe/Berlin',
  SESSION_SECRET: 'not-a-secret-a-published-test-signing-key',
  MASTER_PASSWORD: 'test-master-password',
  SALON_PASSWORD: 'test-salon-password',
  SALON_PIN: '2468',
}

function without(name: keyof typeof complete): Record<string, string> {
  const env = { ...complete }
  delete env[name]
  return env
}

describe('loadConfig', () => {
  it('defaults to loopback and port 3000', () => {
    const config = loadConfig(complete)
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3000)
  })

  it('treats an empty HOST as unset rather than as every interface', () => {
    // The hole the first review found. Node resolves listen(port, '') to `::`, so an empty
    // line in .env published every customer name on the machine's public address while the
    // server still reported loopback - and there is no authentication behind it.
    expect(loadConfig({ ...complete, HOST: '' }).host).toBe('127.0.0.1')
    expect(loadConfig({ ...complete, HOST: '   ' }).host).toBe('127.0.0.1')
  })

  it('still allows an explicit host, because that is a deliberate act', () => {
    expect(loadConfig({ ...complete, HOST: '0.0.0.0' }).host).toBe('0.0.0.0')
  })

  it('refuses to start without a database url', () => {
    expect(() => loadConfig(without('DATABASE_URL'))).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...complete, DATABASE_URL: '  ' })).toThrow(/DATABASE_URL/)
  })

  it('refuses to guess the salon timezone', () => {
    // A wrong connection string fails obviously. A guessed timezone makes the board
    // quietly a day out for part of every night, which is why there is no default.
    expect(() => loadConfig(without('SALON_TIMEZONE'))).toThrow(/SALON_TIMEZONE/)
    expect(() => loadConfig({ ...complete, SALON_TIMEZONE: 'Europe/Salon' })).toThrow(/SALON_TIMEZONE/)
  })

  it('refuses to start without each of the four credentials, and names the one that is missing', () => {
    // ADR-0017: four names, four reasons to refuse. A server that starts with three of them
    // set is a server nobody can log into, or one signing cookies with nothing.
    for (const name of ['SESSION_SECRET', 'MASTER_PASSWORD', 'SALON_PASSWORD', 'SALON_PIN'] as const) {
      expect(() => loadConfig(without(name))).toThrow(new RegExp(name))
      expect(() => loadConfig({ ...complete, [name]: '   ' })).toThrow(new RegExp(name))
    }
  })

  it('refuses a signing secret short enough to guess', () => {
    // The failure this prevents is silent: a one-character secret signs cookies perfectly
    // well, and anybody who guesses it writes their own session.
    expect(() => loadConfig({ ...complete, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
    expect(() => loadConfig({ ...complete, SESSION_SECRET: 'x'.repeat(32) })).not.toThrow()
  })

  it('holds the seeds to the same rules the settings screen will', () => {
    // Otherwise the environment can seed a password nobody is allowed to type again.
    expect(() => loadConfig({ ...complete, SALON_PASSWORD: 'kurz' })).toThrow(/SALON_PASSWORD/)
    expect(() => loadConfig({ ...complete, SALON_PIN: '123' })).toThrow(/SALON_PIN/)
    expect(() => loadConfig({ ...complete, SALON_PIN: 'zwei' })).toThrow(/SALON_PIN/)
  })

  it('marks the session cookie Secure exactly when the bind address is not loopback', () => {
    // Derived rather than configured, and this is the whole rule. Loopback is stage one over
    // plain HTTP, where a Secure cookie would never come back and nobody could log in; any
    // other address is a deploy, which the product brief says is a deploy behind HTTPS.
    expect(loadConfig(complete).cookieSecure).toBe(false)
    expect(loadConfig({ ...complete, HOST: 'localhost' }).cookieSecure).toBe(false)
    expect(loadConfig({ ...complete, HOST: '0.0.0.0' }).cookieSecure).toBe(true)
  })

  it('refuses a port that is not one', () => {
    expect(() => loadConfig({ ...complete, PORT: 'http' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '70000' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '3000.5' })).toThrow(/PORT/)
  })
})
