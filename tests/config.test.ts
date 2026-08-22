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

  it('guesses the session cookie from the bind address when nothing says otherwise', () => {
    // Loopback is stage one over plain HTTP, where a Secure cookie would never come back and
    // nobody could log in; any other address is a deploy, which the brief says is behind HTTPS.
    expect(loadConfig(complete).cookieSecure).toBe(false)
    expect(loadConfig({ ...complete, HOST: 'localhost' }).cookieSecure).toBe(false)
    expect(loadConfig({ ...complete, HOST: '0.0.0.0' }).cookieSecure).toBe(true)
  })

  it('lets COOKIE_SECURE overrule that guess, because the guess has a wrong case', () => {
    // The case a security pass named: TLS terminated by a proxy on the same machine, this
    // process bound to loopback, the board served over HTTPS and the cookie set without Secure.
    // From in here that deployment is indistinguishable from stage one, so it has to be said.
    expect(loadConfig({ ...complete, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true)
    expect(loadConfig({ ...complete, HOST: '0.0.0.0', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false)

    // And an unset or empty value is not "false" - it is "nothing was said", which is the guess.
    expect(loadConfig({ ...complete, COOKIE_SECURE: '  ' }).cookieSecure).toBe(false)
    expect(loadConfig({ ...complete, HOST: '0.0.0.0', COOKIE_SECURE: '' }).cookieSecure).toBe(true)

    // Anything else is a typo, and a typo that reads as false would be silent.
    expect(() => loadConfig({ ...complete, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/)
    expect(() => loadConfig({ ...complete, COOKIE_SECURE: '1' })).toThrow(/COOKIE_SECURE/)
  })

  it('refuses a port that is not one', () => {
    expect(() => loadConfig({ ...complete, PORT: 'http' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '70000' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '3000.5' })).toThrow(/PORT/)
  })

  it('trusts no proxy hop unless one is asked for', () => {
    // The default is the load-bearing half. Trusting a hop with nothing in front means a
    // caller picks their own address in a header, which hands every attempt limiter away -
    // so silence has to mean "trust nothing", not "guess".
    expect(loadConfig(complete).trustProxy).toBe(0)
    expect(loadConfig({ ...complete, TRUST_PROXY: '' }).trustProxy).toBe(0)
    expect(loadConfig({ ...complete, TRUST_PROXY: '  ' }).trustProxy).toBe(0)
    expect(loadConfig({ ...complete, TRUST_PROXY: '0' }).trustProxy).toBe(0)

    expect(loadConfig({ ...complete, TRUST_PROXY: '1' }).trustProxy).toBe(1)
    expect(loadConfig({ ...complete, TRUST_PROXY: ' 2 ' }).trustProxy).toBe(2)
  })

  it('refuses true and false by name, because they are what somebody will reach for', () => {
    // `trust proxy: true` trusts the whole chain, so the leftmost X-Forwarded-For entry is
    // whatever the caller wrote. Coercing it to a number would read as 0 and be silent; the
    // message has to say why the answer is a hop count.
    expect(() => loadConfig({ ...complete, TRUST_PROXY: 'true' })).toThrow(/hops, not true or false/)
    expect(() => loadConfig({ ...complete, TRUST_PROXY: 'TRUE' })).toThrow(/hops, not true or false/)
    expect(() => loadConfig({ ...complete, TRUST_PROXY: 'false' })).toThrow(/hops, not true or false/)
  })

  it('refuses a hop count that is not one', () => {
    expect(() => loadConfig({ ...complete, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ ...complete, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ ...complete, TRUST_PROXY: '1.5' })).toThrow(/TRUST_PROXY/)
  })
})
