# ADR-0018: The settings screen owns staff and hours

- Status: accepted, **not yet implemented**
- Date: 2026-08-13
- Amends: [ADR-0002](ADR-0002-employees-are-deactivated-never-deleted.md) with one narrow
  exception, and supersedes the "core hours are a constant, not configuration" paragraph of
  [ADR-0015](ADR-0015-core-hours-shade-the-board-and-refuse-nothing.md)

## Context

There is no employee write path in this application. Staff are created with an `INSERT` by hand,
which means the one thing the salon cannot do for itself is the thing they will need on the day
somebody is hired. The salon's core hours are a constant in `src/calendar/opening.ts`, and a
review pass already recorded that the shading goes silently wrong the day the hours change with
nothing to notice.

The owner asked for a settings screen and, asked what else belonged in it, chose staff,
credentials and the core hours - deliberately not the holiday list.

Nothing here is built. Credentials are ADR-0017; this is the rest of the screen.

## Decision

**Staff: add, rename, reorder, deactivate, reactivate, and delete only when they have never held
an entry.**

**That delete is a narrow exception to ADR-0002, and the database already enforces it.**
`appointment.employee_id` is `NOT NULL REFERENCES employee (id)`, so deleting anybody with a
single appointment fails at the constraint. The screen's job is to turn that into a German
sentence rather than to discover it. Everybody with history is deactivated, which is ADR-0002
unchanged, and ADR-0012 already decides what that does to the board: they and their appointments
leave it entirely.

The exception exists for the case ADR-0002 did not have in mind: a name typed wrong, or somebody
who never started. An inactive row for a person who was never a person is clutter with no history
to protect.

**Renaming and reordering are safe by construction.** ADR-0002 chose `position` over the name for
column order precisely so that renaming does not move anybody, and this is the first thing that
uses that. Reordering is up and down buttons over six rows, not a drag: the board's drag code has
nothing to do with this, and it cost five review blockers to get right.

**Core hours move into the database and out of `opening.ts`.** `GET /api/day` starts sending the
hours for the day it is answering, and the board draws its shading from that rather than
computing it from a constant. One source of truth, changeable without a release, which is what
ADR-0015 said it would need the day somebody wanted to change them without one.

**The hours have no history.** One row per weekday, so editing Saturday re-shades every Saturday
that ever was. The owner accepted this explicitly: the colour exists to show where appointments
can normally be made, and a past day that no longer matches is not a problem worth a versioned
table.

**The holiday list stays in the code**, as ADR-0016 has it, expiry test and all.

## Consequences

- The screen is the first thing in this application that writes to `employee`. Every rule about
  that table - `position` ordering, `active` semantics, the foreign key - stops being theoretical.
- `coreHoursOn` stops being a pure client-side function of the date. The holiday half of
  `opening.ts` stays where it is, so that file ends up with one foot on each side; if that reads
  badly once written, the holidays follow the hours into the database and ADR-0016 gets a
  successor.
- Deactivating somebody with next Tuesday booked is allowed and still hides those customers, per
  ADR-0012. That was accepted when ADR-0012 was written and it is worth re-reading before this
  screen makes deactivation a one-click action rather than an `UPDATE` by hand.
- Editing the hours changes the shading on days that already happened. See above; accepted.
- Nothing here touches the board's gestures, the write path for appointments, or the colour rule.

## Alternatives rejected

- **Staff and credentials only, leaving the hours in code.** My recommendation, on the grounds
  that authentication is already the biggest piece of work left. Rejected by the owner, who wants
  the hours editable - and the review finding about silent staleness is on their side of the
  argument.
- **Everything currently hardcoded, including the holiday list.** Fifty rows somebody would have
  to type or import, two more tables, and it removes the 2030 expiry test that is the only thing
  which will notice the list going stale. Rejected as the largest version of the feature for the
  least benefit.
- **Delete anybody, cascading to their appointments.** Honest about what the word means and it
  destroys the record that real customers were served, which is what ADR-0002 exists to prevent.
- **No delete at all.** ADR-0002 unchanged and one fewer endpoint. Rejected because the mistyped
  name then stays in the list forever.
- **Drag to reorder.** Nicer for six columns, and a second drag implementation in a codebase
  where the first one cost five review blockers.
- **Versioned hours, effective from a date.** Correct for a business that changes its hours and
  wants old days to render as they were. Rejected as roughly double the work for a colour whose
  job is recognition, not record-keeping.
