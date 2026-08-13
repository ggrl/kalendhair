import { describe, expect, it } from 'vitest'
import {
  MINIMUM_PASSWORD_LENGTH,
  hashSecret,
  secretMatches,
  whyPasswordUnusable,
  whyPinUnusable,
} from '../server/credentials.js'

// The hashing half of ADR-0017, with no database in it. What the row does is in auth.db.test.ts.

describe('hashSecret', () => {
  it('accepts the secret it was made from, and nothing else', async () => {
    const stored = await hashSecret('correct horse battery staple')

    await expect(secretMatches('correct horse battery staple', stored)).resolves.toBe(true)
    await expect(secretMatches('Correct horse battery staple', stored)).resolves.toBe(false)
    await expect(secretMatches('', stored)).resolves.toBe(false)
  })

  it('never stores the secret itself', async () => {
    const stored = await hashSecret('ammoniumchlorid')
    expect(stored).not.toContain('ammoniumchlorid')
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
  })

  it('salts, so two salons with one password do not share a hash', async () => {
    // Without this a stolen dump tells you which salons chose the same password, and one
    // cracked hash opens all of them.
    expect(await hashSecret('gleiches passwort')).not.toBe(await hashSecret('gleiches passwort'))
  })

  it('refuses to answer for a stored value it did not write', async () => {
    // Loudly rather than as "wrong password": it means somebody edited the row, and a person
    // hunting for a typo they did not make will not find it.
    await expect(secretMatches('anything', 'not-a-hash')).rejects.toThrow(/salt:key/)
    await expect(secretMatches('anything', 'aabb:ccdd')).rejects.toThrow(/expected length/)
  })
})

describe('what may be chosen', () => {
  it('refuses a password shorter than the minimum, and says so in German', () => {
    expect(whyPasswordUnusable('x'.repeat(MINIMUM_PASSWORD_LENGTH - 1))).toMatch(/mindestens/)
    expect(whyPasswordUnusable('x'.repeat(MINIMUM_PASSWORD_LENGTH))).toBeNull()
  })

  it('wants exactly four digits for the PIN', () => {
    expect(whyPinUnusable('1234')).toBeNull()
    // Leading zeros are a PIN, not a number. A version of this that parsed the field as an
    // integer would have made 0042 into 42 and refused it.
    expect(whyPinUnusable('0042')).toBeNull()

    expect(whyPinUnusable('123')).toMatch(/vier Ziffern/)
    expect(whyPinUnusable('12345')).toMatch(/vier Ziffern/)
    expect(whyPinUnusable('12 4')).toMatch(/vier Ziffern/)
    expect(whyPinUnusable('abcd')).toMatch(/vier Ziffern/)
    expect(whyPinUnusable('')).toMatch(/vier Ziffern/)
  })
})
