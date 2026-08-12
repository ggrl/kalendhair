import { useState } from 'react'
import type { Entry } from '../calendar/types'
import { SLOT_COUNT, slotFromWallClock } from '../calendar/grid'

interface Props {
  entry: Entry
  /** 1-based column for CSS grid: column 1 is the time scale. */
  column: number
}

/**
 * One box on the board.
 *
 * Placed with CSS grid rows rather than absolute pixels, which is possible only because
 * ADR-0001 forbids two entries overlapping on one employee - so no box ever has to share
 * horizontal space with another. The rule in the database is what makes the layout simple.
 */
export function EntryBox({ entry, column }: Props) {
  const [showNotes, setShowNotes] = useState(false)

  const start = slotFromWallClock(entry.startsAt)
  const end = slotFromWallClock(entry.endsAt)

  // An entry outside the drawn window, or not on a quarter hour, cannot be placed honestly.
  // Saying so beats drawing it in the wrong row: nothing can create one today, and if that
  // changes this is the message that will say so.
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > SLOT_COUNT) {
    return (
      <div className="entry entry--unplaceable" style={{ gridColumn: column, gridRow: '1 / span 4' }}>
        {entry.startsAt}&ndash;{entry.endsAt} passt nicht ins Raster
      </div>
    )
  }

  const isBlock = entry.kind === 'block'
  const timeRange = `${entry.startsAt}–${entry.endsAt}`

  if (isBlock) {
    return (
      <div
        className="entry entry--block"
        style={{ gridColumn: column, gridRow: `${start + 1} / span ${end - start}` }}
        title={`${timeRange} gesperrt`}
      >
        <span className="entry__time">{timeRange}</span>
        <span className="entry__label">Gesperrt</span>
      </div>
    )
  }

  // One row of grid is one line of text. Stacking time, customer and treatment in that space
  // hides the customer entirely, which puts an appointment on the board that cannot be read.
  const slots = end - start
  const compact = slots <= 1

  const summary = [timeRange, entry.customer, entry.treatment, entry.notes].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      className={`entry entry--appointment${compact ? ' entry--compact' : ''}`}
      // Everything the box may have had to clip, available on hover. Not a substitute for
      // fitting: a receptionist scanning the day should not have to hover.
      title={summary}
      style={{
        gridColumn: column,
        gridRow: `${start + 1} / span ${end - start}`,
        // ADR-0009: assigned by the server from the whole day. The browser does not derive
        // it, or two clients would disagree about which boxes are the same customer.
        backgroundColor: entry.colour ?? undefined,
      }}
      aria-expanded={entry.notes === null ? undefined : showNotes}
      onClick={() => setShowNotes((open) => !open)}
    >
      <span className="entry__time">{compact ? entry.startsAt : timeRange}</span>
      <span className="entry__customer">{entry.customer}</span>
      {!compact && entry.treatment !== null && <span className="entry__treatment">{entry.treatment}</span>}
      {entry.notes !== null && (
        <span className="entry__notes-marker" aria-hidden="true">
          &#9633;
        </span>
      )}
      {showNotes && entry.notes !== null && <span className="entry__notes">{entry.notes}</span>}
    </button>
  )
}
