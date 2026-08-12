import type { Entry } from '../calendar/types'
import { slotFromWallClock } from '../calendar/grid'

interface Props {
  entry: Entry
  /** 1-based column for CSS grid: column 1 is the time scale. */
  column: number
  onOpen: () => void
}

/**
 * One box on the board.
 *
 * Placed with CSS grid rows rather than absolute pixels, which is possible only because
 * ADR-0001 forbids two entries overlapping on one employee - so no box ever has to share
 * horizontal space with another. The rule in the database is what makes the layout simple.
 *
 * Every box is a button now, and every one of them does something: clicking opens the entry
 * for editing. That replaces click-to-peek at the notes, which the modal shows instead - one
 * gesture with one meaning, and no note panel covering the appointment underneath it.
 */
export function EntryBox({ entry, column, onOpen }: Props) {
  const start = slotFromWallClock(entry.startsAt)
  const end = slotFromWallClock(entry.endsAt)
  const slots = end - start
  const timeRange = `${entry.startsAt}–${entry.endsAt}`

  const placement = { gridColumn: column, gridRow: `${start + 1} / span ${slots}` }

  if (entry.kind === 'block') {
    return (
      <button
        type="button"
        className="entry entry--appointment entry--block"
        style={placement}
        title={`${timeRange} gesperrt`}
        onClick={onOpen}
      >
        <span className="entry__time">{timeRange}</span>
        <span className="entry__label">Gesperrt</span>
      </button>
    )
  }

  // How much text the box can hold, by measurement rather than by taste. One row is 17.6px,
  // which after margins, borders and padding leaves a single line - so the time and the name
  // share it and the treatment does not fit. Two rows leave 31px, and a compact first line plus
  // a treatment line needs 29.5px, so the treatment does fit and is shown.
  const oneLine = slots <= 1
  const compact = slots <= 2

  // Deliberately excludes the notes. They were in here, and a tooltip appears on hover - which
  // revealed an allergy note to anyone standing at the desk. Three review passes caught it.
  const summary = [timeRange, entry.customer, entry.treatment].filter(Boolean).join(' · ')

  const className = [
    'entry',
    'entry--appointment',
    compact ? 'entry--compact' : '',
    oneLine ? 'entry--one-line' : '',
    entry.notes !== null ? 'entry--has-notes' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      title={summary}
      // ADR-0009: the colour is assigned by the server from the whole day. The browser does not
      // derive it, or two clients would disagree about which boxes are one customer.
      style={{ ...placement, backgroundColor: entry.colour ?? undefined }}
      onClick={onOpen}
    >
      {compact ? (
        <span className="entry__line">
          <span className="entry__time">{entry.startsAt}</span>
          <span className="entry__customer">{entry.customer}</span>
        </span>
      ) : (
        <>
          <span className="entry__time">{timeRange}</span>
          <span className="entry__customer">{entry.customer}</span>
        </>
      )}
      {!oneLine && entry.treatment !== null && <span className="entry__treatment">{entry.treatment}</span>}
      {/* Still a signal that there is something written about this customer, even though the
          text now lives in the form rather than popping out of the box. */}
      {entry.notes !== null && <span className="entry__notes-marker">Notiz</span>}
    </button>
  )
}
