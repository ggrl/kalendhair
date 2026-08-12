import { describe, expect, it } from 'vitest'
import { PALETTE, assignColours, customerKey } from '../src/calendar/colours.js'
import type { ColourInput } from '../src/calendar/colours.js'

function appointment(id: string, customer: string, startsAt: string): ColourInput {
  return { id, kind: 'appointment', customer, startsAt }
}

function block(id: string, startsAt: string): ColourInput {
  return { id, kind: 'block', customer: null, startsAt }
}

describe('customerKey', () => {
  it('ignores case and surrounding space', () => {
    expect(customerKey('  Anna Schmidt ')).toBe(customerKey('anna schmidt'))
  })

  it('does not merge two different people', () => {
    expect(customerKey('Anna Schmidt')).not.toBe(customerKey('Anna Schmid'))
  })
})

describe('assignColours', () => {
  it('gives one customer the same colour twice', () => {
    const colours = assignColours([
      appointment('a', 'Anna', '09:00'),
      appointment('b', 'Bea', '10:00'),
      appointment('c', 'Anna', '11:00'),
    ])

    expect(colours.get('a')).toBe(colours.get('c'))
    expect(colours.get('b')).not.toBe(colours.get('a'))
  })

  it('gives blocks no colour', () => {
    const colours = assignColours([block('a', '09:00')])
    expect(colours.get('a')).toBeNull()
  })

  it('never uses a colour outside the palette', () => {
    const entries = Array.from({ length: 40 }, (_, index) =>
      appointment(`id-${index}`, `Customer ${index}`, '09:00'),
    )

    const colours = assignColours(entries)

    for (const colour of colours.values()) {
      expect(PALETTE as readonly string[]).toContain(colour)
    }
  })

  it('serves customers with two appointments before customers with one', () => {
    // The accepted degradation in ADR-0009: once the palette runs out, colours repeat.
    // This is the ordering that decides who the repeat lands on, and it must land on
    // single appointments rather than on the pairs the colour exists to show.
    const pairMembers = [
      appointment('pair-a', 'Returning', '19:00'),
      appointment('pair-b', 'Returning', '19:30'),
    ]
    const singles = Array.from({ length: PALETTE.length }, (_, index) =>
      appointment(`single-${index}`, `Single ${index}`, `0${index % 9}:00`),
    )

    const colours = assignColours([...singles, ...pairMembers])

    // The pair gets the first colour despite starting latest in the day.
    expect(colours.get('pair-a')).toBe(PALETTE[0])
    expect(colours.get('pair-b')).toBe(PALETTE[0])

    // Eleven customers, ten colours, so exactly one colour is worn by two customers. The
    // point of the ordering rule is which two: it must not be the pair, or a stranger
    // looks like the other half of a split appointment.
    //
    // The first version of this test asserted the opposite while its comment claimed
    // this, and passed, because a plain modulo wrapped customer eleven onto the pair's
    // colour. Assert the property, not the arithmetic.
    const singleColours = singles.map((entry) => colours.get(entry.id))
    expect(singleColours).not.toContain(PALETTE[0])

    const shared = singleColours.filter(
      (colour, index) => singleColours.indexOf(colour) !== index,
    )
    expect(shared).toHaveLength(1)
    expect(shared[0]).not.toBe(PALETTE[0])
  })

  it('never lets a single appointment wear a pair\'s colour, however many customers there are', () => {
    const pairs = [
      appointment('p1-a', 'Pair One', '09:00'),
      appointment('p1-b', 'Pair One', '13:00'),
      appointment('p2-a', 'Pair Two', '09:15'),
      appointment('p2-b', 'Pair Two', '13:15'),
    ]
    const singles = Array.from({ length: 30 }, (_, index) =>
      appointment(`single-${index}`, `Single ${index}`, '10:00'),
    )

    const colours = assignColours([...pairs, ...singles])
    const pairColours = new Set([colours.get('p1-a'), colours.get('p2-a')])

    expect(pairColours.size).toBe(2)
    for (const single of singles) {
      expect(pairColours.has(colours.get(single.id))).toBe(false)
    }
  })

  it('produces the same colours whatever order the rows arrive in', () => {
    // Same start time for all three, so only the tie-break decides. Without a total
    // ordering the colours would depend on however the database happened to return the
    // rows, and the board would change colour between two identical reads.
    const entries = [
      appointment('a', 'Zoe', '09:00'),
      appointment('b', 'Adam', '09:00'),
      appointment('c', 'Mia', '09:00'),
    ]

    const sortedById = (input: ColourInput[]): [string, string | null][] =>
      [...assignColours(input)].sort((left, right) => (left[0] < right[0] ? -1 : 1))

    expect(sortedById([...entries].reverse())).toEqual(sortedById(entries))
  })

  it('handles a day with nothing in it', () => {
    expect(assignColours([]).size).toBe(0)
  })
})
