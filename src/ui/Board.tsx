import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CoreHours, Day, Entry } from '../calendar/types'
import {
  DAY_ENDS_AT,
  DAY_STARTS_AT,
  SLOT_COUNT,
  SLOT_MINUTES,
  hourLabels,
  isPlaceable,
  rangeFromSlots,
  slotAt,
  slotFromWallClock,
  whyNotFree,
} from '../calendar/grid'
import { EntryBox } from './EntryBox'
import { previewOf } from './gesture'
import type { Gesture, Preview } from './gesture'

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
  /**
   * Whether a drag is in flight, told to whoever needs to leave the board alone while it is.
   *
   * ADR-0019: the poll must not redraw the board under a moving box. The gesture lives here and
   * nowhere else, so this is the only honest way for anything outside to know about it - and it
   * is a notification, not a control. Nothing here changes because of what the listener does.
   */
  onGesturing: (active: boolean) => void
}

/**
 * How narrow a stylist's column may get before the board scrolls sideways instead. ADR-0021.
 *
 * Applied at every width with no breakpoint, so it only ever bites when there is not enough room:
 * on a laptop with six stylists the columns are `1fr` exactly as before, and the minimum is what
 * stops a phone - or a salon that grows to ten people - squeezing them into something unreadable.
 * Measured: at 150px a customer name and a treatment both render in full.
 */
const MIN_COLUMN = '150px'

/**
 * The width of the hour scale down the left.
 *
 * 4rem until the day-step buttons lost their boxes: the scale was sized to sit beside a control
 * and now sits beside nothing, so it keeps what "08:00" at 0.75rem actually needs plus its own
 * 0.4rem of padding, and gives the rest back to the columns.
 *
 * One constant because two grids use it - the headings and the board - and they are the pair that
 * must never disagree. Sizing them apart is what once put every heading over the wrong stylist.
 */
const SCALE_WIDTH = '2.5rem'

/**
 * The hour the board is scrolled to when it opens.
 *
 * The bookable day starts at 06:00 and the salon almost never uses the first two hours: the
 * earliest core start is 08:00, on a Saturday. So the board opened on two empty hours and every
 * session began by scrolling past them.
 *
 * One fixed hour, deliberately, rather than each day's own core start from the settings screen.
 * That would put Tuesday at 09:00 and Saturday at 08:00, so the board would sit somewhere
 * different from one day to the next while the times stayed in the same place - and 06:00 to
 * 08:00 stays bookable and reachable either way, because this scrolls and refuses nothing.
 */
const OPENS_AT = '08:00'

interface Undrawn {
  entry: Entry
  reason: string
}

/**
 * The nearest ancestor that actually scrolls vertically, or null if nothing does.
 *
 * Found rather than named. The scrollport is `.shell__day`, which this component does not own and
 * should not have to know the class of - and it is the element `App.tsx` may lay out differently
 * tomorrow. `scrollHeight > clientHeight` is part of the test because an element can be `overflow:
 * auto` and have nothing to scroll, and scrolling that one moves nothing.
 */
function scrollportOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = window.getComputedStyle(parent).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent
    }
  }
  return null
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

/**
 * The stretches of the day the salon is not normally working, as grid rows.
 *
 * Shading only: ADR-0015. Nothing here refuses a booking, and `grid.ts` still owns the bookable
 * window - 06:00 to 20:00, every day, for everybody. A closed day arrives as null and comes back
 * as one band covering the board, which is the same answer for Sunday, Monday and a public
 * holiday: ADR-0018 has the server decide that, so the client combines no rules of its own.
 *
 * The slots are clamped because these times arrive over the network. The API refuses hours outside
 * the bookable window, so a band reaching past the edge means the server is wrong - and the way
 * the browser reports a negative grid row or one past the last is to drop the element out of the
 * grid entirely, which looks exactly like a salon that is open all day.
 *
 * **The clamp covers the range and not the grid.** A time that is not on a quarter hour gives a
 * fractional row, which the browser also drops, and nothing here rounds it - the API refuses those
 * too, and a second opinion about which row 09:07 belongs on is how the shading and the settings
 * screen would come to disagree about the same number.
 */
function closedBands(core: CoreHours | null): { startSlot: number; endSlot: number }[] {
  if (core === null) return [{ startSlot: 0, endSlot: SLOT_COUNT }]

  const opens = Math.min(Math.max(slotFromWallClock(core.from), 0), SLOT_COUNT)
  const closes = Math.min(Math.max(slotFromWallClock(core.to), 0), SLOT_COUNT)

  return [
    { startSlot: 0, endSlot: opens },
    { startSlot: closes, endSlot: SLOT_COUNT },
  ].filter((band) => band.endSlot > band.startSlot)
}

/**
 * The one stretch of the day the salon normally works, or null when it does not work at all.
 *
 * What the alternating row shading is drawn over. Derived from the same two numbers and clamped the
 * same way as `closedBands`, deliberately rather than by subtracting the bands from the day: the
 * stripes have to stop exactly where the grey wash starts, and one edge computed two ways is how
 * a one-row seam of the wrong colour appears at 09:00.
 */
function openBand(core: CoreHours | null): { startSlot: number; endSlot: number } | null {
  if (core === null) return null

  const opens = Math.min(Math.max(slotFromWallClock(core.from), 0), SLOT_COUNT)
  const closes = Math.min(Math.max(slotFromWallClock(core.to), 0), SLOT_COUNT)

  return closes > opens ? { startSlot: opens, endSlot: closes } : null
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

export function Board({
  day,
  onOpenEntry,
  onOpenSlot,
  onToggleWholeDay,
  onDragged,
  onRefused,
  onGesturing,
}: Props) {
  const columnOf = new Map(day.employees.map((employee, index) => [employee.id, index + 2]))

  const grid = useRef<HTMLDivElement>(null)
  const columns = useRef<(HTMLDivElement | null)[]>([])
  /** The `OPENS_AT` label, which is what the board is scrolled to, and whether that has happened. */
  const opening = useRef<HTMLDivElement>(null)
  const landed = useRef(false)
  /** The sticky column headings, whose height is what the landing has to clear. */
  const headings = useRef<HTMLDivElement>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)

  // Reported from an effect rather than from each place that sets a gesture, so there is one
  // announcement per actual change and no path through this file can forget to make it. A drag
  // ends in several ways - dropped, refused, cancelled - and each one used to be its own chance
  // to leave the poll thinking a gesture was still in flight.
  useEffect(() => {
    onGesturing(gesture !== null)
  }, [gesture, onGesturing])

  // Once, when the board first has a grid to scroll - not on every day. A day step keeps the
  // position the person chose, because somebody working through an afternoon should not be sent
  // back to the morning by pressing "next day". The guard is a ref rather than a dependency list
  // for the same reason: `day` changes on every poll, and ADR-0019 says a poll is not a
  // navigation, so it must not move the board under a reader.
  //
  // It runs when the column count changes because a day with nobody on it renders no grid at all,
  // and the first day loaded can be one of those.
  useEffect(() => {
    const line = opening.current
    if (line === null) {
      // No grid to scroll: a day with nobody on it. The scroll position dies with the grid, so the
      // landing has to be owed again - a review pass walked staffed day, empty day, staffed day and
      // arrived back at 06:00 with this flag still saying the job was done.
      landed.current = false
      return
    }
    if (landed.current) return
    landed.current = true

    // NOT `scrollIntoView`, which was the first version of this and cost more than it bought. It
    // sets the browser's sequential focus navigation starting point to the element it scrolls to,
    // so the first Tab after every load continued from the hour scale deep inside the board: a
    // review pass measured Tab, Enter opening a customer's appointment, with the whole top bar -
    // settings, Heute, Neuer Termin, both week steps - unreachable by tabbing forward at all.
    //
    // Setting `scrollTop` moves the pane and touches nothing else. The cost is that
    // `scroll-padding-top` no longer applies, so the height of the sticky headings is subtracted
    // here instead - measured from the element rather than named as a number, because the headings
    // are one line on a laptop and two on a phone.
    const pane = scrollportOf(line)
    if (pane === null) return
    const clearance = headings.current?.getBoundingClientRect().height ?? 0
    // Floored, so the rounding can only ever leave 08:00 BELOW the headings and never tucked under
    // them. This aims the label exactly flush with their bottom edge, which is a knife edge: the
    // grid's own top is a fractional number of pixels, so the exact target lands a fraction either
    // side of flush depending on the row height. It was landing 0.41px high the moment the row
    // height changed, which is the difference between a visible label and a clipped one.
    pane.scrollTop += Math.floor(line.getBoundingClientRect().top - pane.getBoundingClientRect().top - clearance)
  }, [day.employees.length])

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
    // A day can legitimately have no columns: nobody active. Since ADR-0012, `readDay` sends an
    // entry only when its employee is active - but it does that in two separate queries with no
    // transaction around them, so a deactivation committed between the two returns entries beside
    // an employee list that no longer holds their column. A review pass demonstrated it with an
    // interleaved UPDATE, which is why this says "does not" and not "cannot".
    //
    // So the report below stays, and is now the only thing standing between an orphaned entry and
    // a silent drop - the one outcome worth engineering against.
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
  const workingRows = openBand(day.coreHours)

  /**
   * Why the gesture cannot be dropped where it is, or null.
   *
   * Only occupied time can refuse a gesture. The other half of "is this bookable" - inside the
   * day, on a quarter hour, not zero length - cannot fail here, because `rangeFromSlots` clamps
   * every gesture into the window by construction; calling `whyNotBookable` as well was a check
   * that could only ever return null. The server calls it regardless, on every write.
   *
   * This is not the authority either. ADR-0001 leaves that to the exclusion constraint, which
   * decides again on every write; this is the browser refusing what the server would refuse
   * anyway, so a mis-drag costs no round trip.
   */
  function refusalFor(preview: Preview, range: { startsAt: string; endsAt: string }, held?: Entry): string | null {
    return whyNotFree(day.entries, { id: held?.id, employeeId: preview.employeeId, ...range })
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

  /** Half a row. Less than this is a hand holding still, not somebody moving an appointment. */
  function dragStartsAfter(): number {
    const box = grid.current?.getBoundingClientRect()
    return box === undefined ? SLOT_MINUTES : box.height / SLOT_COUNT / 2
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    // Left button only. A right click belongs to the browser's own menu, and a middle click on a
    // board that saves on release is nobody's intention.
    if (event.button !== 0) return

    const target = event.target as HTMLElement

    // The frozen hour scale is not part of anybody's column. It is sticky, so once the board is
    // scrolled sideways it covers whichever column has passed under it - and the grid resolves a
    // stylist from the pointer's x, so a press here opened a form for somebody nobody could see.
    // Refused here rather than with `pointer-events: none`, which only makes the press fall
    // through to the grid underneath and reach the same wrong column.
    if (target.closest('.board__scale') !== null || target.closest('.board__hour') !== null) return

    const box = target.closest<HTMLElement>('[data-entry-id]')
    const slot = slotFrom(event.clientY)
    const held = { date: day.date, fromY: event.clientY, travelled: false }

    if (box !== null) {
      const entry = drawable.find((candidate) => candidate.id === box.dataset.entryId)
      if (entry === undefined) return
      const edge = target.dataset.edge
      setGesture(
        edge === 'top' || edge === 'bottom'
          ? { ...held, kind: 'resize', entry, edge, slot }
          : { ...held, kind: 'move', entry, employeeId: entry.employeeId, anchorSlot: slot, slot },
      )
    } else {
      const employeeId = employeeFrom(event.clientX)
      if (employeeId === null) return
      setGesture({ ...held, kind: 'create', employeeId, anchorSlot: slot, slot })
    }

    // Capture, so a drag that leaves the grid - or the window - still ends up here rather than
    // being lost with the box left mid-move.
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (gesture === null) return

    // A finger never moves a booking. ADR-0021.
    //
    // The gesture still starts on touch, because a tap is how the form is opened and that runs
    // through the same machinery - a press that never travels is a click.
    //
    // **What this actually prevents is noise, not a lost appointment**, and the difference was
    // measured rather than assumed. Chromium claims a touch drag for panning and sends
    // `pointercancel` - one `pointermove` arrives first, then the cancel, and that holds even when
    // nothing on the page can scroll. So the write was never reachable. But that single move is
    // already past the drag threshold, so without this line every attempt to scroll the board that
    // began on top of a box would flash a preview and then raise "Die Bewegung wurde abgebrochen"
    // on release - a refusal, in German, for something nobody tried to do, on every scroll.
    if (event.pointerType === 'touch') return

    const slot = slotFrom(event.clientY)
    const farEnough = gesture.travelled || Math.abs(event.clientY - gesture.fromY) >= dragStartsAfter()

    if (gesture.kind === 'move') {
      const employeeId = employeeFrom(event.clientX) ?? gesture.employeeId
      // Sideways counts on its own: crossing into another column is unmistakably deliberate, and a
      // column is far wider than any twitch. Only a move can do it - a resize belongs to the
      // entry's own column, and a range being dragged out stays in the column it started in,
      // because reaching sideways while deciding how long something takes is not a change of
      // stylist.
      const travelled = farEnough || employeeId !== gesture.employeeId
      if (slot !== gesture.slot || employeeId !== gesture.employeeId || travelled !== gesture.travelled) {
        setGesture({ ...gesture, slot, employeeId, travelled })
      }
      return
    }

    if (slot !== gesture.slot || farEnough !== gesture.travelled) {
      setGesture({ ...gesture, slot, travelled: farEnough })
    }
  }

  function onPointerUp(): void {
    if (gesture === null) return
    const held = gesture
    setGesture(null)

    // The board went to another day while the pointer was down - a mouse's back button needs no
    // pointer event to do it. Whatever this gesture was aiming at is no longer on screen, columns
    // included, so it is abandoned rather than applied to a day nobody was looking at.
    if (held.date !== day.date) {
      onRefused('Der angezeigte Tag hat sich geändert. Es wurde nichts verschoben.')
      return
    }

    // A press that never travelled is a click, whatever row line it happened to sit on. On a box
    // that opens the form; on empty grid it proposes the quarter hour that was pressed.
    //
    // Opened from here rather than left to the box's own click handler, because capturing the
    // pointer retargets the click that follows to the capturing element - the grid - so a box
    // pressed with a mouse never sees one. The handler on the box stays for the keyboard, where
    // Enter produces a click and no pointer events at all.
    if (!held.travelled) {
      if (held.kind === 'create') {
        const one = slotAt(held.anchorSlot)
        onOpenSlot(held.employeeId, one.startsAt, one.endsAt)
      } else {
        onOpenEntry(held.entry)
      }
      return
    }

    const preview = previewOf(held)
    const range = rangeFromSlots(preview.startSlot, preview.endSlot)
    // Dragged out and back again: the brief's own awkward case. Nothing changed, so nothing is
    // written and no form opens - the gesture was already answered by putting it back.
    if (!preview.changed) return

    const reason = refusalFor(preview, range, held.kind === 'create' ? undefined : held.entry)
    if (reason !== null) {
      // The box springs back by itself: clearing the gesture draws it at the time it still has.
      // A proposal that was painted red is refused here too, rather than opening a form that
      // would only be refused on Speichern - which is the whole point of saying so before the
      // release.
      onRefused(reason)
      return
    }

    if (held.kind === 'create') {
      // Still nothing written. The range is a proposal, and the form is where it becomes an entry.
      onOpenSlot(preview.employeeId, range.startsAt, range.endsAt)
      return
    }

    onDragged(held.entry, { employeeId: preview.employeeId, startsAt: range.startsAt, endsAt: range.endsAt })
  }

  const preview = gesture === null || !gesture.travelled ? null : previewOf(gesture)
  const previewRange = preview === null ? null : rangeFromSlots(preview.startSlot, preview.endSlot)
  const previewRefused =
    preview === null || previewRange === null
      ? false
      : refusalFor(preview, previewRange, gesture?.kind === 'create' ? undefined : gesture?.entry) !== null

  return (
    <div className="board">
      <Undrawable entries={undrawn} />

      {/* One width for both grids, and it is the reason this wrapper exists.
          The headings and the board are separate grids. Sized independently, a `1fr` track
          resolves from each grid's *own* widest item - the headings from the names, the board from
          the boxes - so they drift apart and every column ends up labelled with the previous
          stylist's name. A review pass measured 46px of drift per column and reproduced headings
          sitting over the wrong bookings. Both grids are now 100% of this one element, so they
          cannot disagree. It wraps only the grids: the undrawn-entries report above would
          otherwise stretch it to the width of a sentence. */}
      <div className="board__scroller">
      {/* Sticky, because 56 rows is taller than a laptop screen: scrolled to the evening, the
          board was four unlabelled pastel columns and a wrong-column booking waiting to
          happen. */}
      <div className="board__heads" ref={headings} style={{ gridTemplateColumns: `${SCALE_WIDTH} repeat(${day.employees.length}, minmax(${MIN_COLUMN}, 1fr))` }}>
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
          gridTemplateColumns: `${SCALE_WIDTH} repeat(${day.employees.length}, minmax(${MIN_COLUMN}, 1fr))`,
          gridTemplateRows: `repeat(${SLOT_COUNT}, var(--slot-height))`,
        }}
        // One set of handlers for the whole grid, not one per column, because a move crosses
        // columns and a gesture that changes owner halfway through cannot be tracked by the thing
        // it started on.
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // A cancelled pointer writes nothing, and says so if there was anything to write. The
        // board going inert while a day loads is one way to get here - `inert` drops pointer
        // capture, so a day arriving under a held pointer ends the gesture before the release
        // does - and an operating system gesture is another. Either way the box goes back to the
        // time it still has, and silence would leave somebody believing they had moved it.
        onPointerCancel={() => {
          if (gesture?.travelled === true) {
            onRefused('Die Bewegung wurde abgebrochen. Es wurde nichts verschoben.')
          }
          setGesture(null)
        }}
      >
        {/* An opaque backdrop for the hour scale, behind the labels and in front of the boxes.
            Without it the frozen column has gaps: a label exists only once an hour, so between
            them an appointment scrolled sideways shows through the gap and the scale looks torn.
            Aria-hidden because it says nothing - the labels are the content. */}
        <div
          className="board__scale"
          style={{ gridColumn: 1, gridRow: `1 / span ${SLOT_COUNT}` }}
          aria-hidden="true"
        />

        {labels.map((label, index) => {
          // The last label marks the end of the final row, not the start of one after it. Placing
          // it at `index * 4 + 1` put 20:00 on row 57 of a 56-row grid, which grew the grid past
          // its own columns.
          const isLast = index === labels.length - 1
          return (
            <div
              key={label}
              ref={label === OPENS_AT ? opening : undefined}
              className={`board__hour${isLast ? ' board__hour--last' : ''}`}
              style={{ gridColumn: 1, gridRow: isLast ? SLOT_COUNT : index * slotsPerHour + 1 }}
            >
              {label}
            </div>
          )
        })}

        {/* Behind everything else, and never in the way of a pointer: the hours the salon does not
            normally work, so the ordinary working day is the white part. It stops at column 2 so
            the hour scale stays plain. */}
        {closedBands(day.coreHours).map((band) => (
          <div
            key={band.startSlot}
            className="board__closed"
            style={{
              gridColumn: `2 / span ${day.employees.length}`,
              gridRow: `${band.startSlot + 1} / span ${band.endSlot - band.startSlot}`,
            }}
            aria-hidden="true"
          />
        ))}

        {/* The alternating rows, over the working stretch only and under the columns that draw the
            grid. Nothing on a day the salon does not work: `openBand` returns null and there is no
            white part for stripes to alternate against. */}
        {workingRows !== null && (
          <div
            className="board__rows"
            style={{
              gridColumn: `2 / span ${day.employees.length}`,
              gridRow: `${workingRows.startSlot + 1} / span ${workingRows.endSlot - workingRows.startSlot}`,
              // The tile starts at the band, so an odd opening slot would shade 09:00 and leave
              // 09:15 white - half a step out from every other day. Shifting the tile down one row
              // puts the pattern back on the clock: even slots from 06:00 stay white.
              backgroundPositionY: workingRows.startSlot % 2 === 0 ? undefined : 'var(--slot-height)',
            }}
            aria-hidden="true"
          />
        )}

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
              // Hour first, then quarter, matching the order the gradients are declared in
              // `styles.css`. Swapping one list without the other sizes the hour rule to a
              // quarter row, which paints a 2px rule every fifteen minutes.
              backgroundSize: `100% calc(var(--slot-height) * ${slotsPerHour}), 100% var(--slot-height)`,
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
            {/* A block has no customer, so it identifies itself by its reason if it has one and by
                the board's own marker if it does not. Shorter than the box's `N/A Urlaub`, because
                this line is a diagnostic and already says the time. */}
            {entry.startsAt}–{entry.endsAt} {entry.customer ?? entry.reason ?? 'N/A'} – {reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
