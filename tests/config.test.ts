import { describe, expect, it } from 'vitest'
import { loadConfig } from '../server/config.js'

const complete = {
  DATABASE_URL: 'postgres://salon@127.0.0.1:5432/salon',
  SALON_TIMEZONE: 'Europe/Berlin',
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
    expect(() => loadConfig({ SALON_TIMEZONE: 'Europe/Berlin' })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...complete, DATABASE_URL: '  ' })).toThrow(/DATABASE_URL/)
  })

  it('refuses to guess the salon timezone', () => {
    // A wrong connection string fails obviously. A guessed timezone makes the board
    // quietly a day out for part of every night, which is why there is no default.
    expect(() => loadConfig({ DATABASE_URL: complete.DATABASE_URL })).toThrow(/SALON_TIMEZONE/)
    expect(() => loadConfig({ ...complete, SALON_TIMEZONE: 'Europe/Salon' })).toThrow(/SALON_TIMEZONE/)
  })

  it('refuses a port that is not one', () => {
    expect(() => loadConfig({ ...complete, PORT: 'http' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '70000' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...complete, PORT: '3000.5' })).toThrow(/PORT/)
  })
})
