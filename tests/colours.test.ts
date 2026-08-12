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

    // With one more customer than there are colours, exactly one colour is shared, and
    // it is shared between two singles rather than by anyone in the pair.
    const singleColours = singles.map((entry) => colours.get(entry.id))
    expect(singleColours.filter((colour) => colour === PALETTE[0])).toHaveLength(1)
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
