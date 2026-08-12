import type { Pool } from 'pg'

/**
 * Names and treatments already typed, for the modal to suggest.
 *
 * Scope is a rolling year, by decision: long enough that a regular is always offered, short
 * enough that the box does not quietly become the salon's entire customer directory. The list
 * is also a way to read out who the salon has ever served, one letter at a time, so the window
 * is a limit on exposure and not only on noise.
 */

/** Only these two columns may be suggested, and the check is a switch rather than a string. */
export type Suggestable = 'customer' | 'treatment'

export function isSuggestable(value: unknown): value is Suggestable {
  return value === 'customer' || value === 'treatment'
}

const HOW_MANY = 8

export async function suggest(
  pool: Pool,
  field: Suggestable,
  query: string,
  today: string,
): Promise<string[]> {
  const needle = query.trim()
  // Nothing typed means nothing suggested. An empty prefix would match every row, which is the
  // whole directory in one request.
  if (needle === '') return []

  // The column name cannot come from the request. `field` is narrowed to one of two literals
  // above, and this switch is what turns it into SQL - there is no path from a caller's string
  // to an identifier.
  const column = field === 'customer' ? 'customer' : 'treatment'

  const result = await pool.query<{ value: string }>(
    `SELECT DISTINCT ON (lower(btrim(${column}))) btrim(${column}) AS value
       FROM appointment
      WHERE kind = 'appointment'
        AND ${column} IS NOT NULL
        AND starts_at >= ($2::date - interval '1 year')
        AND left(lower(btrim(${column})), length($1)) = lower($1)
      ORDER BY lower(btrim(${column}))
      LIMIT ${HOW_MANY}`,
    [needle, today],
  )

  return result.rows.map((row) => row.value)
}
