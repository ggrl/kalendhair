-- ADR-0018: the salon's core hours stop being a constant in `src/calendar/opening.ts` and become
-- seven rows the settings screen can change. ADR-0015 named the condition under which that would
-- happen - the day somebody wants the hours changed without a release - and then that day arrived.

CREATE TABLE core_hours (
  -- ISO 8601 weekday: Monday is 1 and Sunday is 7, the same numbering `weekdayOf` returns, so
  -- the server never has to translate between two ways of counting a week.
  --
  -- Seven rows, no more and no fewer, and no history. Editing Saturday re-shades every Saturday
  -- there has ever been. The owner accepted that explicitly: the colour exists to show where
  -- appointments normally go, not to keep a record of where they once went.
  weekday   smallint PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),

  -- Null on both when the salon does not normally work that day. Wall clock in the salon's own
  -- timezone and never an instant, exactly as the appointment times are: ADR-0007.
  opens_at  time,
  closes_at time,

  -- Open with both times or closed with neither. One of the two set is a row nobody can draw
  -- and nobody meant to write.
  CONSTRAINT core_hours_both_or_neither CHECK ((opens_at IS NULL) = (closes_at IS NULL)),

  -- The API refuses this first, with a German sentence naming the weekday. This is what makes it
  -- true rather than merely usually true.
  CONSTRAINT core_hours_positive_span CHECK (opens_at IS NULL OR closes_at > opens_at)

  -- Deliberately NOT constrained to 06:00-20:00 here, for the same reason `001_init.sql` does not
  -- constrain the appointment times: `src/calendar/grid.ts` is the single home of the bookable
  -- window, and a copy of it in SQL is a second place for that number to disagree with itself.
  -- The API checks these against `grid.ts` before they reach this table.
);

-- Seeded with exactly what `CORE_HOURS` held on the day it was deleted, so no board's shading
-- moves by a pixel when this migration runs: Tuesday to Friday 09:00-18:00, Saturday 08:00-13:30,
-- Sunday and Monday closed. A database test asserts these seven values rather than trusting this
-- comment, because a seed that silently disagreed with the constant would change every board in
-- the salon and look like nothing at all.
INSERT INTO core_hours (weekday, opens_at, closes_at) VALUES
  (1, NULL,    NULL),
  (2, '09:00', '18:00'),
  (3, '09:00', '18:00'),
  (4, '09:00', '18:00'),
  (5, '09:00', '18:00'),
  (6, '08:00', '13:30'),
  (7, NULL,    NULL);
