# ADR-0018: The settings screen owns staff and hours

- Status: accepted. **Staff and credentials built on 2026-08-13; the core hours are not**, and
  until they are, ADR-0015's constant is still the only place they live
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

## What building it settled, on 2026-08-13

The staff half and the credentials half are built; the hours are not, and were deliberately left
for their own change. Four things this ruling did not say, decided while writing it:

- **The PIN is asked for every time the screen is opened**, and it is the owner's choice over
  anything longer-lived. There is no unlock ticket of any kind: the PIN travels in a header on
  every settings request, the server checks it on each one, and the screen holds it in memory for
  exactly as long as it is on screen. Nothing to leave lying around on the front desk machine.
- **A wrong PIN is 403 and an ended session is 401**, because the screen's answer differs: one
  sends somebody back to the PIN prompt and the other to the login screen. The session is checked
  first, so somebody with the PIN and no session learns nothing about whether their four digits
  were right.
- **Reordering renumbers the whole list from 1 rather than swapping two rows.** Swapping assumes
  the positions are already distinct, and in this database they are not: every employee row
  predates this screen and nothing ever stopped two of them sharing a number.
- **Changing the PIN sends the screen back to its own prompt, saying why.** The PIN it was holding
  is the old one the moment the change lands, so every further request would be refused for a
  reason nobody could guess from the screen.
- **Column order breaks ties on the id, never on the name.** It broke on the name first, which
  made this ruling's own "renaming does not move anybody" false wherever two positions were equal -
  and equal positions are the reason the reordering renumbers rather than swaps. A review pass
  renamed the middle of three tied rows and watched her column move on every day of the board.
- **The new salon password is typed twice**, and it is the only field in the application that is.
  Both passes arrived at it: one masked field, one typo, and the salon is locked out of a board
  whose password nobody knows, with the way back being the master password out of the environment.
  The master-password screen keeps its single field, where a typo costs re-typing something you
  are already holding.

## Known, accepted, and not fixed here

- **An appointment can still be booked against a deactivated stylist through the API.** Nothing in
  `createEntry` checks `active`, so the row lands in the table, holds a slot in the exclusion
  constraint and renders nowhere - ADR-0012. It predates this screen, but this screen turns
  deactivation from an `UPDATE` by hand into a one-click button, which widens the window. Named by
  the security pass, left alone deliberately: it belongs with the write path, not with a screen.
- **The PIN travels in a header on every settings request.** Nothing here logs headers and the
  usual proxy default does not either, but it becomes a leak the day somebody turns on header
  logging while debugging. One line for the deploy notes, next to `trust proxy`.

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
