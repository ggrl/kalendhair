// ADR-0009: colour is a claim, not decoration. Two boxes share a colour only if they
// are the same customer, because the reason colour exists is the dye case - a customer
// split across two appointments with somebody else's in between.
//
// This module imports nothing. It is used by the server and could be used by the
// browser, and the two resolve modules differently; a free-standing file pleases both.

/**
 * Light enough for dark text on a 15-minute box, spread evenly around the hue circle so
 * neighbours are told apart at a glance, and containing no grey - grey means a block.
 *
 * Ten colours is the honest count. A day with more than ten distinct customers reuses
 * one, and two strangers then look like a pair. That degradation was chosen knowingly;
 * `assignColours` orders assignment so it lands on single appointments first.
 */
export const PALETTE = [
  '#f4b8b8',
  '#f8cfa0',
  '#f0eaa0',
  '#c2e6a8',
  '#a6e3d0',
  '#a8dcee',
  '#b8c8f0',
  '#cfc0ee',
  '#ecc0e8',
  '#f6c2d4',
] as const

/** Only the fields colouring needs. Structural, so callers need not own a shared type. */
export interface ColourInput {
  id: string
  kind: 'appointment' | 'block'
  customer: string | null
  startsAt: string
}

/**
 * ADR-0009: trimmed and case-insensitive, so "anna schmidt" and "Anna Schmidt" are one
 * customer. Without this the link between a customer's two appointments fails silently,
 * which is worse than not drawing it at all.
 */
export function customerKey(customer: string): string {
  return customer.trim().toLowerCase()
}

/**
 * Colours for one day's entries, keyed by entry id. Blocks map to null: they are grey.
 *
 * Assignment is per day rather than hashed from the name. Hashing would put two
 * unrelated customers on one colour by accident, and an accidental pair is
 * indistinguishable from the real one this feature exists to show.
 */
export function assignColours(entries: readonly ColourInput[]): Map<string, string | null> {
  const byCustomer = new Map<string, ColourInput[]>()

  for (const entry of entries) {
    if (entry.kind !== 'appointment' || entry.customer === null) continue
    const key = customerKey(entry.customer)
    const group = byCustomer.get(key)
    if (group === undefined) byCustomer.set(key, [entry])
    else group.push(entry)
  }

  // Customers with more than one appointment today are served first, so that when the
  // palette runs out the repeats land on single appointments rather than on the pairs
  // the colour is there to show. Earliest start and then name break ties, so the same
  // day always produces the same colours rather than depending on iteration order.
  const order = [...byCustomer.entries()].sort((a, b) => {
    if (a[1].length !== b[1].length) return b[1].length - a[1].length
    const aStart = earliestStart(a[1])
    const bStart = earliestStart(b[1])
    if (aStart !== bStart) return aStart < bStart ? -1 : 1
    return a[0] < b[0] ? -1 : 1
  })

  // Customers holding more than one box today. Their colours are the ones that carry the
  // claim, so no overflow may land on them.
  const withPartner = order.filter(([, group]) => group.length > 1).length

  const colourFor = new Map<string, string>()
  order.forEach(([key], index) => {
    colourFor.set(key, PALETTE[paletteSlot(index, withPartner)])
  })

  const result = new Map<string, string | null>()
  for (const entry of entries) {
    const key = entry.kind === 'appointment' && entry.customer !== null ? customerKey(entry.customer) : null
    result.set(entry.id, key === null ? null : (colourFor.get(key) ?? null))
  }
  return result
}

/**
 * Which palette slot the customer at `index` gets, where `reserved` slots at the front
 * belong to customers with more than one appointment today.
 *
 * A plain `index % PALETTE.length` looked like it implemented the ordering rule and did
 * the opposite: customer eleven wrapped to slot 0, which is the colour of the customer
 * with the most appointments. So the one arrangement the rule exists to protect - a pair
 * unmistakably belonging together - was the first one broken, and a stranger wore the
 * pair's colour on any day with eleven customers. Overflow reuses only the slots given to
 * single appointments.
 */
function paletteSlot(index: number, reserved: number): number {
  if (index < PALETTE.length) return index

  const reusable = PALETTE.length - reserved
  // More multi-appointment customers than colours. Nothing is safe to reuse, so fall back
  // to plain wrapping rather than pretending otherwise. Ten simultaneous split
  // appointments in one day is not a salon, but the arithmetic still has to terminate.
  if (reusable <= 0) return index % PALETTE.length

  return reserved + ((index - PALETTE.length) % reusable)
}

function earliestStart(entries: readonly ColourInput[]): string {
  return entries.reduce((earliest, entry) => (entry.startsAt < earliest ? entry.startsAt : earliest), entries[0].startsAt)
}
