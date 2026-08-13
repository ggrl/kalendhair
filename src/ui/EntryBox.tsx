import type { Entry } from '../calendar/types'
import { rangeFromSlots, slotFromWallClock } from '../calendar/grid'

interface Props {
  entry: Entry
  /** 1-based column for CSS grid: column 1 is the time scale. */
  column: number
  /**
   * Where this box is being dragged to, while a gesture holds it. The box is drawn there and
   * reads out that time, so the person sees the appointment they are about to have rather than
   * the one they started with - and `refused` says the drop will not be taken, before they let go.
   */
  drag?: { startSlot: number; endSlot: number; refused: boolean }
  onOpen: () => void
}

/**
 * The two edges a resize starts from.
 *
 * Real elements rather than a pixel test against the box's rectangle, so the cursor changes on
 * its own and the hit area is the same thing the eye sees. Sized as a share of the box in CSS,
 * because a fixed 6px would swallow a 15-minute box whole: one slot is 17.6px.
 */
function Grips() {
  return (
    <>
      <span className="entry__grip entry__grip--top" data-edge="top" aria-hidden="true" />
      <span className="entry__grip entry__grip--bottom" data-edge="bottom" aria-hidden="true" />
    </>
  )
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
export function EntryBox({ entry, column, drag, onOpen }: Props) {
  const start = drag?.startSlot ?? slotFromWallClock(entry.startsAt)
  const end = drag?.endSlot ?? slotFromWallClock(entry.endsAt)
  const slots = end - start
  const shown = drag === undefined ? entry : rangeFromSlots(drag.startSlot, drag.endSlot)
  const timeRange = `${shown.startsAt}–${shown.endsAt}`

  const placement = { gridColumn: column, gridRow: `${start + 1} / span ${slots}` }
  // Both classes are pure feedback: the drag is decided by where the pointer is, never by what
  // the box looks like.
  const dragClass = drag === undefined ? '' : drag.refused ? ' entry--dragging entry--refused' : ' entry--dragging'

  if (entry.kind === 'block') {
    // The word `gesperrt` has to survive in the name whatever the reason says, and `title` alone
    // does not do that: a button with text content takes its accessible name from the content, and
    // `title` is only consulted when there is none. So a screen reader heard "14:00 bis 15:00
    // Urlaub, Schaltfläche", which is indistinguishable from an appointment for a customer called
    // Urlaub - the hatching is the only other signal and it cannot be heard. A review pass measured
    // it after this comment claimed the opposite.
    const spoken = entry.reason === null ? `${timeRange} gesperrt` : `${timeRange} gesperrt: ${entry.reason}`

    // A 15-minute block is 15.6px tall and its second line starts below the bottom edge, so a
    // reason on the shortest block the grid allows was drawn nowhere at all - which is the promise
    // ADR-0014 makes, broken in the one case that needed it most. The appointment path already
    // solved this by putting the time and the text on one line; this is the same answer.
    const tight = slots <= 2

    return (
      <button
        type="button"
        className={`entry entry--appointment entry--block${tight ? ' entry--compact' : ''}${dragClass}`}
        style={placement}
        title={spoken}
        // Only when a reason has taken the word's place. With no reason the content already reads
        // `Gesperrt`, and overriding it there would rename the box for no gain - it broke two
        // tests that matched on the visible word, which was the right complaint.
        aria-label={entry.reason === null ? undefined : spoken}
        data-entry-id={entry.id}
        onClick={onOpen}
      >
        {/* ADR-0014: `Urlaub` in place of `Gesperrt`, because a reason nobody can see without
            clicking is worth less than the word it replaced. */}
        {tight ? (
          <span className="entry__line">
            <span className="entry__time">{shown.startsAt}</span>
            <span className="entry__label">{entry.reason ?? 'Gesperrt'}</span>
          </span>
        ) : (
          <>
            <span className="entry__time">{timeRange}</span>
            <span className="entry__label">{entry.reason ?? 'Gesperrt'}</span>
          </>
        )}
        <Grips />
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
    dragClass.trim(),
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
      data-entry-id={entry.id}
      onClick={onOpen}
    >
      {compact ? (
        <span className="entry__line">
          <span className="entry__time">{shown.startsAt}</span>
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
      <Grips />
    </button>
  )
}
