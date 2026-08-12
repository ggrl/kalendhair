import type { MouseEvent } from 'react'
import type { Day, Entry } from '../calendar/types'
import { DAY_ENDS_AT, DAY_STARTS_AT, SLOT_COUNT, SLOT_MINUTES, hourLabels, isPlaceable, slotAt } from '../calendar/grid'
import { EntryBox } from './EntryBox'

interface Props {
  day: Day
  onOpenEntry: (entry: Entry) => void
  onOpenSlot: (employeeId: string, startsAt: string, endsAt: string) => void
  /** Ticking creates one 06:00-20:00 block; unticking removes the one that is there. */
  onToggleWholeDay: (employeeId: string, existing: Entry | undefined) => void
}

interface Undrawn {
  entry: Entry
  reason: string
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

export function Board({ day, onOpenEntry, onOpenSlot, onToggleWholeDay }: Props) {
  const columnOf = new Map(day.employees.map((employee, index) => [employee.id, index + 2]))

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

  /** Which quarter hour a click landed on, from where it fell inside the column. */
  function slotFromClick(event: MouseEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect()
    return Math.floor(((event.clientY - box.top) / box.height) * SLOT_COUNT)
  }

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
        style={{
          gridTemplateColumns: `4rem repeat(${day.employees.length}, 1fr)`,
          gridTemplateRows: `repeat(${SLOT_COUNT}, var(--slot-height))`,
        }}
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
            style={{
              gridColumn: index + 2,
              gridRow: `1 / span ${SLOT_COUNT}`,
              // `:last-of-type` counted div siblings, and blocks are divs rendered after the
              // columns - so any day containing a block lost the board's right-hand edge.
              borderRight: index + 2 === lastColumn ? '1px solid var(--rule-hour)' : undefined,
              backgroundSize: `100% var(--slot-height), 100% calc(var(--slot-height) * ${slotsPerHour})`,
            }}
            // Clicking empty grid proposes that quarter hour. Dragging out a range comes later;
            // until then this is how a booking starts, and the form lets the end time be typed.
            onClick={(event) => {
              const { startsAt, endsAt } = slotAt(slotFromClick(event))
              onOpenSlot(employee.id, startsAt, endsAt)
            }}
            aria-label={`Freie Zeit bei ${employee.name}`}
          />
        ))}

        {drawable.map((entry) => (
          <EntryBox
            key={entry.id}
            entry={entry}
            column={columnOf.get(entry.employeeId) as number}
            onOpen={() => onOpenEntry(entry)}
          />
        ))}
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
