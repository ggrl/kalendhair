import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * The salon's three credentials, and the one row that holds two of them.
 *
 * ADR-0017: the salon password and the four-digit PIN are scrypt hashes in the database and
 * the salon can change them; the master password stays in the environment and is the only way
 * back in when both are forgotten. This module owns what a usable password is, how one is
 * hashed, and what changing one does to everybody's session. Nothing outside it reads
 * `salon_credential`.
 */

/**
 * scrypt from `node:crypto`, so authentication adds no dependency.
 *
 * These three numbers are Node's own defaults, written out rather than left implicit because
 * every stored hash depends on them: changing one makes every existing hash fail to verify,
 * and the salon is then locked out until somebody uses the master password. That is the way
 * back in, and it is the reason this can be a plain `salt:key` string with no version prefix.
 */
const COST = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 64
const SALT_LENGTH = 16

/** ADR-0004 puts one password in front of every customer name, so it is not allowed to be tiny. */
export const MINIMUM_PASSWORD_LENGTH = 8

function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, COST, (error, key) => {
      if (error !== null) reject(error)
      else resolve(key)
    })
  })
}

/** A new salt and a key from it, as `salt:key` in hex. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(secret, salt)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

/**
 * Whether a secret produces the stored key, compared in constant time.
 *
 * A stored string that is not `salt:key` throws rather than answering false. It cannot happen
 * from this module, so it means the row was edited by hand or corrupted - and a silent "wrong
 * password" would send somebody hunting for a typo they did not make.
 */
export async function secretMatches(secret: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':')
  if (saltHex === undefined || keyHex === undefined) {
    throw new Error('stored credential is not in salt:key form')
  }

  // Buffer.from truncates silently at the first character that is not hex, so the length is
  // checked rather than trusted - timingSafeEqual throws on a length mismatch.
  const expected = Buffer.from(keyHex, 'hex')
  if (expected.length !== KEY_LENGTH) {
    throw new Error('stored credential does not hold a key of the expected length')
  }

  return timingSafeEqual(await derive(secret, Buffer.from(saltHex, 'hex')), expected)
}

/**
 * Why this password cannot be used, in the German the screen shows, or null when it can.
 *
 * The rule lives here alone: the startup check, the reset screen and any later settings screen
 * all ask this rather than each having their own idea of what is acceptable.
 */
export function whyPasswordUnusable(password: string): string | null {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Das Passwort muss mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen haben.`
  }
  return null
}

/** The same, for the PIN. ADR-0017 says four digits, so four digits is what is stored. */
export function whyPinUnusable(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Die PIN besteht aus genau vier Ziffern.'
  return null
}

/**
 * Writes the seeds, and only when there is no row.
 *
 * ADR-0017: `SALON_PASSWORD` and `SALON_PIN` seed the row once and are ignored afterwards.
 * Without that, a restart would silently undo every change made in the settings screen and
 * put the leaver's password back.
 *
 * `ON CONFLICT DO NOTHING` rather than the read alone, because two instances starting together
 * both read an empty table - the same race the migration lock exists for.
 */
export async function seedCredentials(pool: Pool, password: string, pin: string): Promise<boolean> {
  const existing = await pool.query('SELECT 1 FROM salon_credential WHERE id = 1')
  if (existing.rowCount === 1) return false

  const result = await pool.query(
    `INSERT INTO salon_credential (id, password_hash, pin_hash) VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [await hashSecret(password), await hashSecret(pin)],
  )
  return result.rowCount === 1
}

/**
 * The version every session is checked against.
 *
 * A missing row is a broken database rather than a reason to let somebody in: the server seeds
 * it at startup, so absent means it was deleted underneath a running process.
 */
export async function currentVersion(pool: Pool): Promise<number> {
  const result = await pool.query<{ version: number }>('SELECT version FROM salon_credential WHERE id = 1')
  const row = result.rows[0]
  if (row === undefined) throw new Error('salon_credential has no row: the salon password is not set')
  return row.version
}

/** The credential version on a correct password, or null. What a login is. */
export async function versionForPassword(pool: Pool, password: string): Promise<number | null> {
  const result = await pool.query<{ password_hash: string; version: number }>(
    'SELECT password_hash, version FROM salon_credential WHERE id = 1',
  )
  const row = result.rows[0]
  if (row === undefined) throw new Error('salon_credential has no row: the salon password is not set')

  return (await secretMatches(password, row.password_hash)) ? row.version : null
}

/**
 * Whether this is the PIN that guards the settings screen. ADR-0017.
 *
 * **There is a counter now, and it is not here.** ADR-0017 allowed none, on the grounds that
 * reaching the prompt needs a valid session "so it is a colleague". ADR-0021 put the board on
 * phones that leave the building, so the owner amended it: ten wrong tries per address per five
 * minutes, applied by `requirePin` in `app.ts` and explicitly a speed bump rather than a lockout.
 * This function still just compares, and the scrypt derive is still the per-try cost - but the
 * sentence that used to be here, saying a derive is the only brake there is, is no longer true.
 */
export async function pinMatches(pool: Pool, pin: string): Promise<boolean> {
  const result = await pool.query<{ pin_hash: string }>('SELECT pin_hash FROM salon_credential WHERE id = 1')
  const row = result.rows[0]
  if (row === undefined) throw new Error('salon_credential has no row: the PIN is not set')

  return secretMatches(pin, row.pin_hash)
}

/**
 * A new salon password, and everybody logged out - the person who changed it included.
 *
 * That is ADR-0017's whole reason for the version column, so it increments here. The screen
 * warns first, because being thrown back to the login screen by your own click is alarming when
 * it is a surprise and obvious when it is not.
 */
export async function replacePassword(pool: Pool, password: string): Promise<void> {
  await write(pool, 'UPDATE salon_credential SET password_hash = $1, version = version + 1 WHERE id = 1', [
    await hashSecret(password),
  ])
}

/**
 * A new PIN, and nobody logged out.
 *
 * The version is about the password: it exists so that a password change ends the sessions the
 * old password bought. A PIN change ends nothing, because no session was ever bought with a PIN -
 * it is asked for again every time the settings screen is opened.
 */
export async function replacePin(pool: Pool, pin: string): Promise<void> {
  await write(pool, 'UPDATE salon_credential SET pin_hash = $1 WHERE id = 1', [await hashSecret(pin)])
}

/**
 * A new password and a new PIN, and everybody logged out.
 *
 * The version increments in the same statement that writes the hashes, so there is no moment
 * where the new password is live and an old session still is.
 */
export async function replaceCredentials(pool: Pool, password: string, pin: string): Promise<void> {
  await write(pool, 'UPDATE salon_credential SET password_hash = $1, pin_hash = $2, version = version + 1 WHERE id = 1', [
    await hashSecret(password),
    await hashSecret(pin),
  ])
}

/** Any of the three writes above, with the missing-row case in one place. */
async function write(pool: Pool, sql: string, values: string[]): Promise<void> {
  const result = await pool.query(sql, values)
  if (result.rowCount !== 1) throw new Error('salon_credential has no row: nothing was changed')
}
