import type { Entry } from '../calendar/types'
import { slotFromWallClock } from '../calendar/grid'

interface Props {
  entry: Entry
  /** 1-based column for CSS grid: column 1 is the time scale. */
  column: number
  /** True when this box's notes are the ones currently open. Only one may be open at a time. */
  notesOpen: boolean
  onToggleNotes: () => void
}

/**
 * One box on the board.
 *
 * Placed with CSS grid rows rather than absolute pixels, which is possible only because
 * ADR-0001 forbids two entries overlapping on one employee - so no box ever has to share
 * horizontal space with another. The rule in the database is what makes the layout simple.
 */
export function EntryBox({ entry, column, notesOpen, onToggleNotes }: Props) {
  const start = slotFromWallClock(entry.startsAt)
  const end = slotFromWallClock(entry.endsAt)
  const slots = end - start
  const timeRange = `${entry.startsAt}–${entry.endsAt}`

  const placement = { gridColumn: column, gridRow: `${start + 1} / span ${slots}` }

  if (entry.kind === 'block') {
    return (
      <div className="entry entry--block" style={placement} title={`${timeRange} gesperrt`}>
        <span className="entry__time">{timeRange}</span>
        <span className="entry__label">Gesperrt</span>
      </div>
    )
  }

  // Two grid rows is 35 px of box and 28 px of content, and three stacked lines need 43.
  // At `slots <= 1` only, a 30-minute appointment took the tall layout it could not hold and
  // the treatment vanished with nothing on screen saying so - most salon services are 30
  // minutes, so that was the common case, not an edge one.
  const compact = slots <= 2
  const hasNotes = entry.notes !== null

  // Deliberately excludes the notes. They were in here, and a tooltip appears on hover -
  // which revealed an allergy note to anyone standing at the desk, breaking the one rule the
  // brief states about notes. Three separate review passes caught it. What the tooltip is
  // for is the text a short box had to clip.
  const summary = [timeRange, entry.customer, entry.treatment].filter(Boolean).join(' · ')

  const className = [
    'entry',
    'entry--appointment',
    compact ? 'entry--compact' : '',
    // Only a box with something to reveal looks and behaves like it can be opened. Making
    // every box pressable taught the receptionist that clicking does nothing, which is the
    // lesson that makes somebody miss the one box carrying an allergy note.
    hasNotes ? 'entry--has-notes' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      <span className="entry__time">{compact ? entry.startsAt : timeRange}</span>
      <span className="entry__customer">{entry.customer}</span>
      {!compact && entry.treatment !== null && <span className="entry__treatment">{entry.treatment}</span>}
      {hasNotes && <span className="entry__notes-marker">Notiz</span>}
      {notesOpen && <span className="entry__notes">{entry.notes}</span>}
    </>
  )

  if (!hasNotes) {
    return (
      <div className={className} style={{ ...placement, backgroundColor: entry.colour ?? undefined }} title={summary}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={className}
      title={summary}
      // ADR-0009: the colour is assigned by the server from the whole day. The browser does
      // not derive it, or two clients would disagree about which boxes are one customer.
      style={{ ...placement, backgroundColor: entry.colour ?? undefined }}
      aria-expanded={notesOpen}
      onClick={onToggleNotes}
    >
      {content}
    </button>
  )
}
