# ADR-0018: The settings screen owns staff and hours

- Status: accepted and **fully built**: staff and credentials on 2026-08-13, the core hours on
  2026-08-14. `CORE_HOURS` no longer exists in `src/calendar/opening.ts`
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

## What building the hours settled, on 2026-08-14

The rest of it. `CORE_HOURS` is gone, `core_hours` holds seven rows, `GET /api/day` sends
`coreHours` for the day it is answering, and the board draws that and computes nothing. Six things
this ruling did not say, five of them asked of the owner:

- **One continuous band per weekday, not two.** A salon that shuts over lunch cannot shade that
  hour. Asked, and answered: the constant could not express it either, nobody has wanted it, and
  the alternative is a row-per-band table plus overlap validation for a colour.
- **Quarter hours only, from a dropdown.** Asked, and answered. The board is a grid of 15-minute
  rows, so 09:07 cannot be drawn where it says - and rounding it would leave the number on the
  settings screen and the band on the board quietly disagreeing. Refusing what cannot be drawn is
  honest; snapping it silently is not.
- **The whole week saves in one press.** Asked, and answered over a save per row. Somebody sits
  down once a year and fixes the hours; seven requests would be seven places to fail and a
  half-edited week for the screen to explain.
- **A backwards or zero-length range is refused, naming the weekday**, rather than read as a closed
  day. Asked, and answered. `Geschlossen` is a tick, and it is the only way to say a day is shut:
  turning `09:00` to `09:00` into "closed" would throw away what somebody typed with nothing on
  screen saying so.
- **The screen says in German that the hours colour the board and refuse nothing.** Asked, and
  answered. A screen that lets somebody edit opening times is exactly where they conclude that
  booking outside them will now be refused, and ADR-0015's whole ruling is that it never is. That
  sentence is the only place the belief can be corrected.
- **A tab that already has the board open keeps the old shading**, until it loads any day - a day
  step, `Heute` or `Aktualisieren`. Asked, and accepted: it is a colour, not a booking. **Nothing
  closes this today**; polling will, when it is built, and the tab that made the change is already
  correct because leaving the settings screen reloads the board.

  > Closed on 2026-08-14 by [ADR-0019](ADR-0019-the-board-polls-and-says-when-it-cannot.md). Polling
  > is built, so an idle tab picks up changed hours within thirty seconds without anybody touching
  > it. The sentence above is kept because it named the condition, and then the condition happened.

And three that are mine:

- **The server applies the holiday rule, not the client.** `Day.coreHours` is one answer rather
  than two rules a client has to combine, so Sunday, Monday and Karfreitag arrive identically. The
  Hessen list stays in the code where ADR-0016 put it; only the decision moved.
- **06:00-20:00 is checked against `grid.ts` and deliberately not written into a SQL constraint**,
  for the same reason `001_init.sql` does not constrain appointment times: that window has one
  home, and a copy of it in a `CHECK` is a second place for it to disagree with itself. The
  structural rules that are not about the window - open with both times or shut with neither, and
  an end after a beginning - are constraints.
- **`germanWeekday` is formatted from a reference Monday**, not written out as seven strings, so
  there is no second spelling of `Mittwoch` to drift from the one `longGermanDate` produces.

## Known, accepted, and not fixed here

- **The week carries no version stamp**, so two people with the settings screen open both hold a
  whole draft and the second save reverts the first. ADR-0003 exists for appointments because that
  race is real inside one polling interval; a colour edited once a year is not that, and the same
  reasoning already covers the staff rows. Considered and not built, written down here so the next
  session does not have to work out whether it was missed.
- **A weekday with no row makes every save impossible from the screen.** `readWeek` would return a
  short week, the screen would render it, and the API would refuse every save for not being seven
  days - with no way out of the interface. Nothing can produce that state: the rows come from the
  migration and no code deletes them. The write refuses rather than answering 204 for a write that
  did not happen, which is the half worth defending.

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
