import type { Day } from '../calendar/types'
import { SLOT_COUNT, SLOT_MINUTES, hourLabels, minutesSinceMidnight, DAY_STARTS_AT } from '../calendar/grid'
import { EntryBox } from './EntryBox'

interface Props {
  day: Day
}

export function Board({ day }: Props) {
  if (day.employees.length === 0) {
    // An honest empty state. ADR-0002 means a day can legitimately have no columns at all -
    // every employee inactive and nothing booked - and a bare grid with no headings would
    // read as a loading failure.
    return <p className="board__empty">Für diesen Tag ist niemand eingeteilt.</p>
  }

  const slotsPerHour = 60 / SLOT_MINUTES
  const firstHour = minutesSinceMidnight(DAY_STARTS_AT) / 60

  return (
    <div className="board">
      <div className="board__heads" style={{ gridTemplateColumns: `4rem repeat(${day.employees.length}, 1fr)` }}>
        <div className="board__corner" />
        {day.employees.map((employee) => (
          <div key={employee.id} className="board__head">
            {employee.name}
          </div>
        ))}
      </div>

      <div
        className="board__grid"
        style={{
          gridTemplateColumns: `4rem repeat(${day.employees.length}, 1fr)`,
          gridTemplateRows: `repeat(${SLOT_COUNT}, var(--slot-height))`,
        }}
      >
        {/* The hour scale. Labels sit on the hour; the quarter rows between them are drawn
            by the row lines, so there is nothing to render per slot. */}
        {hourLabels().map((label, index) => (
          <div
            key={label}
            className="board__hour"
            style={{ gridColumn: 1, gridRow: index * slotsPerHour + 1 }}
          >
            {label}
          </div>
        ))}

        {/* One background cell per employee column, carrying the hour rules. */}
        {day.employees.map((employee, index) => (
          <div
            key={employee.id}
            className="board__column"
            style={{
              gridColumn: index + 2,
              gridRow: `1 / span ${SLOT_COUNT}`,
              // Two gradients: a faint line every quarter hour, a firmer one every hour.
              backgroundSize: `100% var(--slot-height), 100% calc(var(--slot-height) * ${slotsPerHour})`,
            }}
            aria-label={`Spalte ${employee.name}`}
          />
        ))}

        {day.entries.map((entry) => {
          const column = day.employees.findIndex((employee) => employee.id === entry.employeeId)
          // An entry whose employee has no column cannot be drawn. It should be impossible:
          // the server returns a column for anybody with an entry that day. Skipping beats
          // guessing a column, and the count is reported below so it is not silent.
          if (column === -1) return null
          return <EntryBox key={entry.id} entry={entry} column={column + 2} />
        })}
      </div>

      <Orphans day={day} />
      <p className="board__scale-note">
        {String(firstHour).padStart(2, '0')}:00 bis {hourLabels().at(-1)}, {SLOT_MINUTES}-Minuten-Raster
      </p>
    </div>
  )
}

/**
 * Says out loud when an entry could not be placed. `rules/coding-standards.md` section D:
 * a silent drop would be discovered months later by somebody looking at a board that is
 * missing an appointment and believing it.
 */
function Orphans({ day }: Props) {
  const known = new Set(day.employees.map((employee) => employee.id))
  const orphans = day.entries.filter((entry) => !known.has(entry.employeeId))
  if (orphans.length === 0) return null

  return (
    <p className="board__orphans" role="alert">
      {orphans.length} Termin(e) konnten nicht angezeigt werden: keine Spalte für die
      zugeordnete Person.
    </p>
  )
}
