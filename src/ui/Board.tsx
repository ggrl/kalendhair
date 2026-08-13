import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Day, Entry } from '../calendar/types'
import {
  DAY_ENDS_AT,
  DAY_STARTS_AT,
  SLOT_COUNT,
  SLOT_MINUTES,
  hourLabels,
  isPlaceable,
  rangeFromSlots,
  slotFromWallClock,
  whyNotBookable,
  whyNotFree,
} from '../calendar/grid'
import { EntryBox } from './EntryBox'

interface Props {
  day: Day
  onOpenEntry: (entry: Entry) => void
  onOpenSlot: (employeeId: string, startsAt: string, endsAt: string) => void
  /** Ticking creates one 06:00-20:00 block; unticking removes the one that is there. */
  onToggleWholeDay: (employeeId: string, existing: Entry | undefined) => void
  /**
   * A move or a resize that has been let go of. The entry is the one that was read, version and
   * all, so ADR-0003 still decides what happens if somebody else changed it in the meantime.
   */
  onDragged: (entry: Entry, target: { employeeId: string; startsAt: string; endsAt: string }) => void
  /** A gesture this board refused before sending it, and the German sentence saying why. */
  onRefused: (reason: string) => void
}

interface Undrawn {
  entry: Entry
  reason: string
}

/**
 * A gesture in progress. Three kinds, because the release means three different things: propose a
 * range, move an entry, or change one of its ends.
 *
 * `slot` is where the pointer is now; nothing here is a pixel, so the board can only ever propose
 * a time it can also draw.
 */
type Gesture =
  | { kind: 'create'; employeeId: string; anchorSlot: number; slot: number }
  | { kind: 'move'; entry: Entry; employeeId: string; anchorSlot: number; slot: number }
  | { kind: 'resize'; entry: Entry; edge: 'top' | 'bottom'; slot: number }

interface Preview {
  employeeId: string
  startSlot: number
  endSlot: number
  /**
   * Whether this is a drag at all. A hand moving three pixels while clicking stays inside one row,
   * which leaves this false and the gesture a click - without it, every shaky click on a box would
   * be a silent move-and-save, and there is no undo to reach for.
   */
  moved: boolean
}

/** Where the gesture currently points, in rows and columns. Pure, so the maths is testable. */
function previewOf(gesture: Gesture): Preview {
  if (gesture.kind === 'create') {
    const first = Math.min(gesture.anchorSlot, gesture.slot)
    const last = Math.max(gesture.anchorSlot, gesture.slot)
    return {
      employeeId: gesture.employeeId,
      startSlot: first,
      endSlot: last + 1,
      moved: gesture.slot !== gesture.anchorSlot,
    }
  }

  const held = gesture.entry
  const start = slotFromWallClock(held.startsAt)
  const end = slotFromWallClock(held.endsAt)

  if (gesture.kind === 'resize') {
    // One slot is the floor. Dragging an edge past its opposite would otherwise ask for a
    // zero-length or backwards entry, which the database refuses and the grid cannot draw.
    const startSlot = gesture.edge === 'top' ? Math.max(Math.min(gesture.slot, end - 1), 0) : start
    const endSlot = gesture.edge === 'bottom' ? Math.min(Math.max(gesture.slot + 1, start + 1), SLOT_COUNT) : end
    return { employeeId: held.employeeId, startSlot, endSlot, moved: startSlot !== start || endSlot !== end }
  }

  // A move keeps its length and slides. Clamped so the whole box stays on the board: dragging
  // towards 21:00 stops at 20:00 rather than proposing a time the server would refuse, and an
  // hour-long appointment stays an hour long.
  const shift = Math.min(Math.max(gesture.slot - gesture.anchorSlot, -start), SLOT_COUNT - end)
  return {
    employeeId: gesture.employeeId,
    startSlot: start + shift,
    endSlot: end + shift,
    moved: shift !== 0 || gesture.employeeId !== held.employeeId,
  }
}

/**
 * Why an entry cannot be drawn. Two separate predicates decide it, so the report says which one
 * rather than offering the reader a choice the code does not have to make.
 */
function undrawnReason(entry: Entry, hasColumn: boolean): string | null {
  if (!hasColumn) return 'die zugeordnete Person hat an diesem Tag keine Spalte'
  if (!isPlaceable(entry.startsAt, entry.endsAt)) {
    return 'die Zeit liegt außerhalb von 06:00–20:00 oder nicht auf einer Viertelstunde'
  }
  return null
}

/** The one block that covers the whole bookable day, if this employee has one. */
function wholeDayBlock(day: Day, employeeId: string): Entry | undefined {
  return day.entries.find(
    (entry) =>
      entry.employeeId === employeeId &&
      entry.kind === 'block' &&
      entry.startsAt === DAY_STARTS_AT &&
      entry.endsAt === DAY_ENDS_AT,
  )
}

export function Board({ day, onOpenEntry, onOpenSlot, onToggleWholeDay, onDragged, onRefused }: Props) {
  const columnOf = new Map(day.employees.map((employee, index) => [employee.id, index + 2]))

  const grid = useRef<HTMLDivElement>(null)
  const columns = useRef<(HTMLDivElement | null)[]>([])
  const [gesture, setGesture] = useState<Gesture | null>(null)

  // Anything the grid cannot draw is listed instead of being forced into it. Two unplaceable
  // entries used to be painted at the same fixed position, hiding each other and any real 06:00
  // appointment, and the box dropped the customer's name.
  const undrawn: Undrawn[] = []
  const drawable: Entry[] = []
  for (const entry of day.entries) {
    const reason = undrawnReason(entry, columnOf.has(entry.employeeId))
    if (reason === null) drawable.push(entry)
    else undrawn.push({ entry, reason })
  }

  if (day.employees.length === 0) {
    // ADR-0002 means a day can legitimately have no columns: everybody inactive and nothing
    // booked. `readDay` returns a column for anyone holding an entry that day, so entries imply
    // employees - but the report is rendered here too rather than relying on that, because a
    // silent drop is the one outcome worth engineering against.
    return (
      <div className="board">
        <Undrawable entries={undrawn} />
        <p className="board__empty">Für diesen Tag ist niemand eingeteilt.</p>
      </div>
    )
  }

  const slotsPerHour = 60 / SLOT_MINUTES
  const labels = hourLabels()
  const lastColumn = day.employees.length + 1

  /**
   * Why the gesture cannot be dropped where it is, or null.
   *
   * Both halves are the browser refusing what the server refuses anyway: `whyNotBookable` is the
   * same function the server calls, and `whyNotFree` reads the day already on screen. Neither is
   * the authority - ADR-0001 leaves that to the exclusion constraint, which decides again on
   * every write.
   */
  function refusalFor(preview: Preview, range: { startsAt: string; endsAt: string }, held?: Entry): string | null {
    return (
      whyNotBookable(range.startsAt, range.endsAt) ??
      whyNotFree(day.entries, { id: held?.id, employeeId: preview.employeeId, ...range })
    )
  }

  /** Which quarter hour a pointer is over, clamped to the board. */
  function slotFrom(clientY: number): number {
    const box = grid.current?.getBoundingClientRect()
    if (box === undefined) return 0
    const row = Math.floor(((clientY - box.top) / box.height) * SLOT_COUNT)
    return Math.min(Math.max(row, 0), SLOT_COUNT - 1)
  }

  /**
   * Whose column a pointer is over. Measured from the columns themselves rather than by dividing
   * the grid up, because column one is the time scale and its width is in `rem`.
   *
   * Past either end it stays with the outermost column: a drag that wanders onto the day strip is
   * a drag to that stylist, not a drop into nothing.
   */
  function employeeFrom(clientX: number): string | null {
    const boxes = day.employees.map((employee, index) => ({
      id: employee.id,
      box: columns.current[index]?.getBoundingClientRect(),
    }))
    const drawn = boxes.filter((column): column is { id: string; box: DOMRect } => column.box !== undefined)
    if (drawn.length === 0) return null

    const over = drawn.find(({ box }) => clientX >= box.left && clientX < box.right)
    if (over !== undefined) return over.id
    return clientX < drawn[0].box.left ? drawn[0].id : drawn[drawn.length - 1].id
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    // Left button only. A right click belongs to the browser's own menu, and a middle click on a
    // board that saves on release is nobody's intention.
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    const box = target.closest<HTMLElement>('[data-entry-id]')
    const slot = slotFrom(event.clientY)

    if (box !== null) {
      const entry = drawable.find((candidate) => candidate.id === box.dataset.entryId)
      if (entry === undefined) return
      const edge = target.dataset.edge
      setGesture(
        edge === 'top' || edge === 'bottom'
          ? { kind: 'resize', entry, edge, slot }
          : { kind: 'move', entry, employeeId: entry.employeeId, anchorSlot: slot, slot },
      )
    } else {
      const employeeId = employeeFrom(event.clientX)
      if (employeeId === null) return
      setGesture({ kind: 'create', employeeId, anchorSlot: slot, slot })
    }

    // Capture, so a drag that leaves the grid - or the window - still ends up here rather than
    // being lost with the box left mid-move.
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (gesture === null) return
    const slot = slotFrom(event.clientY)

    if (gesture.kind === 'move') {
      const employeeId = employeeFrom(event.clientX) ?? gesture.employeeId
      if (slot !== gesture.slot || employeeId !== gesture.employeeId) setGesture({ ...gesture, slot, employeeId })
      return
    }

    // A range being dragged out stays in the column it started in. Reaching sideways while
    // deciding how long something takes is not a change of stylist.
    if (slot !== gesture.slot) setGesture({ ...gesture, slot })
  }

  function onPointerUp(): void {
    if (gesture === null) return
    const preview = previewOf(gesture)
    const range = rangeFromSlots(preview.startSlot, preview.endSlot)
    setGesture(null)

    if (gesture.kind === 'create') {
      // Nothing is written here. The range is a proposal, and the form is where it becomes an
      // appointment - which is also what a plain click on empty grid does, one row long.
      onOpenSlot(preview.employeeId, range.startsAt, range.endsAt)
      return
    }

    // Under one row and in the same column: a click, so the form opens and nothing is saved.
    //
    // Opened from here rather than left to the box's own click handler, because capturing the
    // pointer retargets the click that follows to the capturing element - the grid - so a box
    // pressed with a mouse never sees one. The handler on the box stays for the keyboard, where
    // Enter produces a click and no pointer events at all.
    if (!preview.moved) {
      onOpenEntry(gesture.entry)
      return
    }
    const reason = refusalFor(preview, range, gesture.entry)
    if (reason !== null) {
      // The box springs back by itself: clearing the gesture draws it at the time it still has.
      onRefused(reason)
      return
    }

    onDragged(gesture.entry, { employeeId: preview.employeeId, startsAt: range.startsAt, endsAt: range.endsAt })
  }

  const preview = gesture === null ? null : previewOf(gesture)
  const previewRange = preview === null ? null : rangeFromSlots(preview.startSlot, preview.endSlot)
  const previewRefused =
    preview === null || previewRange === null
      ? false
      : refusalFor(preview, previewRange, gesture?.kind === 'create' ? undefined : gesture?.entry) !== null

  return (
    <div className="board">
      <Undrawable entries={undrawn} />

      {/* Sticky, because 56 rows is taller than a laptop screen: scrolled to the evening, the
          board was four unlabelled pastel columns and a wrong-column booking waiting to
          happen. */}
      <div className="board__heads" style={{ gridTemplateColumns: `4rem repeat(${day.employees.length}, 1fr)` }}>
        <div className="board__corner" />
        {day.employees.map((employee) => {
          const blocked = wholeDayBlock(day, employee.id)
          return (
            <div key={employee.id} className="board__head">
              <span>{employee.name}</span>
              {/* ADR-0008: blocking a whole day is one 06:00-20:00 row and nothing else, which
                  is why ticking this on a column that already has bookings is refused by the
                  same constraint that stops any other clash.

                  Still a checkbox, so it keeps the role and the keyboard behaviour, but drawn as
                  a red cross rather than a tick - a blue tick reads as "on" when what it means is
                  "nobody is working". The words moved to the tooltip because repeating them in
                  every column was more noise than the switch is worth, and `aria-label` alone
                  shows a sighted mouse user nothing. */}
              <input
                type="checkbox"
                className="board__blocked"
                aria-label={`Ganzen Tag für ${employee.name} sperren`}
                title={
                  blocked === undefined
                    ? `Ganzen Tag für ${employee.name} sperren`
                    : `Sperre für ${employee.name} aufheben`
                }
                checked={blocked !== undefined}
                onChange={() => onToggleWholeDay(employee.id, blocked)}
              />
            </div>
          )
        })}
      </div>

      <div
        className="board__grid"
        ref={grid}
        style={{
          gridTemplateColumns: `4rem repeat(${day.employees.length}, 1fr)`,
          gridTemplateRows: `repeat(${SLOT_COUNT}, var(--slot-height))`,
        }}
        // One set of handlers for the whole grid, not one per column, because a move crosses
        // columns and a gesture that changes owner halfway through cannot be tracked by the thing
        // it started on.
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // A cancelled pointer writes nothing. The box returns to the time it still has.
        onPointerCancel={() => setGesture(null)}
      >
        {labels.map((label, index) => {
          // The last label marks the end of the final row, not the start of one after it. Placing
          // it at `index * 4 + 1` put 20:00 on row 57 of a 56-row grid, which grew the grid past
          // its own columns.
          const isLast = index === labels.length - 1
          return (
            <div
              key={label}
              className={`board__hour${isLast ? ' board__hour--last' : ''}`}
              style={{ gridColumn: 1, gridRow: isLast ? SLOT_COUNT : index * slotsPerHour + 1 }}
            >
              {label}
            </div>
          )
        })}

        {day.employees.map((employee, index) => (
          <div
            key={employee.id}
            className="board__column"
            ref={(element) => {
              columns.current[index] = element
            }}
            style={{
              gridColumn: index + 2,
              gridRow: `1 / span ${SLOT_COUNT}`,
              // `:last-of-type` counted div siblings, and blocks are divs rendered after the
              // columns - so any day containing a block lost the board's right-hand edge.
              borderRight: index + 2 === lastColumn ? '1px solid var(--rule-hour)' : undefined,
              backgroundSize: `100% var(--slot-height), 100% calc(var(--slot-height) * ${slotsPerHour})`,
            }}
            aria-label={`Freie Zeit bei ${employee.name}`}
          />
        ))}

        {/* What a drag on empty grid is proposing. Not an entry: nothing exists until the form
            is saved, so this is drawn as an outline and reads out the times it would ask for. */}
        {preview !== null && previewRange !== null && gesture?.kind === 'create' && (
          <div
            className={`board__proposal${previewRefused ? ' board__proposal--refused' : ''}`}
            style={{
              gridColumn: columnOf.get(preview.employeeId) as number,
              gridRow: `${preview.startSlot + 1} / span ${preview.endSlot - preview.startSlot}`,
            }}
            aria-hidden="true"
          >
            {previewRange.startsAt}–{previewRange.endsAt}
          </div>
        )}

        {drawable.map((entry) => {
          const held =
            preview !== null && gesture !== null && gesture.kind !== 'create' && gesture.entry.id === entry.id
              ? preview
              : null

          return (
            <EntryBox
              key={entry.id}
              entry={entry}
              column={columnOf.get(held?.employeeId ?? entry.employeeId) as number}
              drag={
                held === null
                  ? undefined
                  : { startSlot: held.startSlot, endSlot: held.endSlot, refused: previewRefused }
              }
              onOpen={() => onOpenEntry(entry)}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Says out loud what could not be drawn, whose it was, and why. `rules/coding-standards.md`
 * section D: a silent drop gets discovered months later by somebody looking at a board that is
 * missing an appointment and believing it.
 */
function Undrawable({ entries }: { entries: Undrawn[] }) {
  if (entries.length === 0) return null

  return (
    <div className="board__undrawable" role="alert">
      <p>
        {entries.length === 1
          ? '1 Termin kann nicht angezeigt werden:'
          : `${entries.length} Termine können nicht angezeigt werden:`}
      </p>
      <ul>
        {entries.map(({ entry, reason }) => (
          <li key={entry.id}>
            {entry.startsAt}–{entry.endsAt} {entry.customer ?? 'Gesperrt'} – {reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
