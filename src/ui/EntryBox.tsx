import type { Entry } from '../calendar/types'
import { SLOT_MINUTES, formatDuration, rangeFromSlots, slotFromWallClock } from '../calendar/grid'

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
  // From the slots being drawn, not from the entry's own times: mid-drag the box shows the
  // appointment somebody is about to have, and its length is part of that.
  const duration = formatDuration(slots * SLOT_MINUTES)

  const placement = { gridColumn: column, gridRow: `${start + 1} / span ${slots}` }
  // Both classes are pure feedback: the drag is decided by where the pointer is, never by what
  // the box looks like.
  const dragClass = drag === undefined ? '' : drag.refused ? ' entry--dragging entry--refused' : ' entry--dragging'

  if (entry.kind === 'block') {
    // `N/A` is the marker on screen, and it is not a word: it says nothing to a screen reader and
    // less than `Gesperrt` did. So the accessible name is German prose and always carries
    // `gesperrt`, whether or not a reason follows it.
    //
    // `title` cannot do this alone. A button with text content takes its accessible name from the
    // content and `title` is only consulted when there is none - which a review pass measured after
    // an earlier version of this comment claimed otherwise.
    const spoken = entry.reason === null ? `${timeRange} gesperrt` : `${timeRange} gesperrt: ${entry.reason}`

    // `N/A` first, then the reason: `N/A Urlaub`. The owner's format, and it undoes ADR-0014's
    // "the reason replaces the word" - the marker now always stands, and the reason qualifies it.
    const label = entry.reason === null ? 'N/A' : `N/A ${entry.reason}`

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
        aria-label={spoken}
        data-entry-id={entry.id}
        onClick={onOpen}
      >
        {tight ? (
          <span className="entry__line">
            <span className="entry__time">{shown.startsAt}</span>
            <span className="entry__label">{label}</span>
            {/* Held to the right of the line rather than pinned to the corner: a one-line box has
                no corner that is not also the line, and pushing it there with `margin-left: auto`
                means the label shrinks around it rather than running underneath a reserved gap. */}
            <span className="entry__meta entry__meta--line">
              <span className="entry__duration">{duration}</span>
            </span>
          </span>
        ) : (
          <>
            <span className="entry__time">{timeRange}</span>
            <span className="entry__label">{label}</span>
            <span className="entry__meta"><span className="entry__duration">{duration}</span></span>
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

  // How long this runs, and a dot if something is written about it. Top right on a box tall enough
  // to have a corner; held to the right of the single line when it is not, which is the same place
  // to the eye and one less thing to reserve room for.
  //
  // The dot replaced the word `Notiz`, which was the widest thing in the corner and the reason the
  // duration had nowhere to go. The word survives for a screen reader, out of sight: a bare `•` is
  // announced as "bullet" or as nothing at all depending on the reader, and losing it would take
  // away the only signal a blind user has that a note exists - the note's text itself is
  // deliberately not on the board, because a tooltip over the box once revealed an allergy to
  // whoever was standing at the desk.
  const meta = (
    <span className={compact ? 'entry__meta entry__meta--line' : 'entry__meta'}>
      <span className="entry__duration">{duration}</span>
      {entry.notes !== null && <span className="visually-hidden">Notiz</span>}
    </span>
  )

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
      {/* How long this runs, and a dot if something is written about it. Top right on a box tall
          enough to have a corner; held to the right of the single line when it is not, which is
          the same place to the eye and one less thing to reserve room for.

          The dot replaced the word `Notiz`, which was the widest thing in the corner and the
          reason the duration had nowhere to go. The word survives for a screen reader, out of
          sight: a bare `•` is announced as "bullet" or as nothing at all depending on the reader,
          and losing it would take away the only signal a blind user has that a note exists - the
          note's text itself is deliberately not on the board, because a tooltip over the box once
          revealed an allergy to whoever was standing at the desk. */}
      {compact ? (
        <span className="entry__line">
          <span className="entry__time">{shown.startsAt}</span>
          <span className="entry__customer">{entry.customer}</span>
          {meta}
        </span>
      ) : (
        <>
          <span className="entry__time">{timeRange}</span>
          <span className="entry__customer">{entry.customer}</span>
        </>
      )}
      {!oneLine && entry.treatment !== null && <span className="entry__treatment">{entry.treatment}</span>}
      {!compact && meta}
      {/* The folded corner: this box has something written about it. A shape rather than a
          character, because a character at this size is what the dot was and the dot was too
          quiet to be a clue.

          A real element and not a `::after`, for the reason the grips give above: a test can find
          this one. `aria-hidden` because the word `Notiz` in the corner is what a screen reader
          gets, and a shape has nothing to say to one. */}
      {entry.notes !== null && <span className="entry__fold" aria-hidden="true" />}
      <Grips />
    </button>
  )
}
