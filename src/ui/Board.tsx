import { useEffect, useState } from "react";
import type { Day, Entry } from "../calendar/types";
import {
  SLOT_COUNT,
  SLOT_MINUTES,
  hourLabels,
  isPlaceable,
} from "../calendar/grid";
import { EntryBox } from "./EntryBox";

interface Props {
  day: Day;
}

export function Board({ day }: Props) {
  // One note open at a time, held here rather than in each box. Several open notes overlap
  // each other and the appointments beneath them, and there was no way to close one except
  // finding it again.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenNoteId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const columnOf = new Map(
    day.employees.map((employee, index) => [employee.id, index + 2]),
  );

  // Anything the grid cannot draw is listed under the board instead of being forced into it.
  // Two unplaceable entries used to be painted at the same fixed position, hiding each other
  // and any real 06:00 appointment, and the box dropped the customer's name - so you could
  // see something was wrong and not whose appointment it was.
  const undrawable = day.entries.filter(
    (entry) =>
      !columnOf.has(entry.employeeId) ||
      !isPlaceable(entry.startsAt, entry.endsAt),
  );
  const drawable = day.entries.filter(
    (entry) =>
      columnOf.has(entry.employeeId) &&
      isPlaceable(entry.startsAt, entry.endsAt),
  );

  if (day.employees.length === 0) {
    // ADR-0002 means a day can legitimately have no columns: everybody inactive and nothing
    // booked. `readDay` returns a column for anyone holding an entry that day, so entries
    // imply employees - but the report below is rendered here too rather than relying on
    // that, because a silent drop is the one outcome worth engineering against.
    return (
      <div className="board">
        <p className="board__empty">Für diesen Tag ist niemand eingeteilt.</p>
        <Undrawable entries={undrawable} />
      </div>
    );
  }

  const slotsPerHour = 60 / SLOT_MINUTES;
  const labels = hourLabels();
  const lastColumn = day.employees.length + 1;

  return (
    <div className="board">
      {/* Sticky, because 56 rows is taller than a laptop screen: scrolled to the evening, the
          board was four unlabelled pastel columns and a wrong-column booking waiting to
          happen. */}
      <div
        className="board__heads"
        style={{
          gridTemplateColumns: `4rem repeat(${day.employees.length}, 1fr)`,
        }}
      >
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
        {labels.map((label, index) => {
          // The last label marks the end of the final row, not the start of one after it.
          // Placing it at `index * 4 + 1` put 20:00 on row 57 of a 56-row grid, which grew
          // the grid past its own columns.
          const isLast = index === labels.length - 1;
          return (
            <div
              key={label}
              className={`board__hour${isLast ? " board__hour--last" : ""}`}
              style={{
                gridColumn: 1,
                gridRow: isLast ? SLOT_COUNT : index * slotsPerHour + 1,
              }}
            >
              {label}
            </div>
          );
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
              borderRight:
                index + 2 === lastColumn
                  ? "1px solid var(--rule-hour)"
                  : undefined,
              backgroundSize: `100% var(--slot-height), 100% calc(var(--slot-height) * ${slotsPerHour})`,
            }}
          />
        ))}

        {drawable.map((entry) => (
          <EntryBox
            key={entry.id}
            entry={entry}
            column={columnOf.get(entry.employeeId) as number}
            notesOpen={openNoteId === entry.id}
            onToggleNotes={() =>
              setOpenNoteId((open) => (open === entry.id ? null : entry.id))
            }
          />
        ))}
      </div>

      <p className="board__legend">
        Gleiche Farbe = gleiche Kundin oder gleicher Kunde am selben Tag.
      </p>
      <Undrawable entries={undrawable} />
    </div>
  );
}

/**
 * Says out loud what could not be drawn, and whose it was. `rules/coding-standards.md`
 * section D: a silent drop gets discovered months later by somebody looking at a board that
 * is missing an appointment and believing it.
 */
function Undrawable({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="board__undrawable" role="alert">
      <p>
        {entries.length === 1
          ? "1 Termin kann nicht angezeigt werden:"
          : `${entries.length} Termine können nicht angezeigt werden:`}
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.startsAt}–{entry.endsAt} {entry.customer ?? "Sperrzeit"}{" "}
            (liegt außerhalb des Rasters oder die zugeordnete Person hat keine
            Spalte)
          </li>
        ))}
      </ul>
    </div>
  );
}
