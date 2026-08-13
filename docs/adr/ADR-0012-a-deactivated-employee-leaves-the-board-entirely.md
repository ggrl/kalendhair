# ADR-0012: A deactivated employee leaves the board entirely

- Status: accepted
- Date: 2026-08-13
- Supersedes: the visibility half of ADR-0002, and the note added to it on 2026-08-12

## Context

ADR-0002 ruled that a deactivated employee keeps their column on any day they hold an
appointment, so a past day reads the way it read when it happened. `readDay` implemented
that with an `OR EXISTS` clause: a column for anyone active, plus anyone with an entry that
date.

The owner asked for the opposite: a deactivated stylist is not on the board at all, even on
days they worked. The board should show the staff list and nothing else.

That is a change of ruling, not a bug, so it is written down here rather than edited into
ADR-0002 - which is also why the reasoning ADR-0002 gave is repeated below instead of being
deleted. It was not wrong. It was outranked.

## Decision

**A column exists for an active employee, on every day, and for nobody else.**

**An entry belonging to an inactive employee does not reach the board.** `readDay` joins
appointments to the employee and requires `active`, so a hidden column cannot produce an
entry with nowhere to sit.

That is a statement about `GET /api/day` and nothing else, and the wording matters because the
first draft of this ADR said "does not leave the server", which is false. `/api/suggestions`
draws on a rolling year of entries with no reference to `employee.active`, so a customer only a
leaver ever served is still offered in the booking form, and so is a treatment only they ever
typed. That is deliberate and is the second half of this decision: **a customer belongs to the
salon, not to the stylist who served them.** Dropping those names would make the salon forget
real people because somebody resigned. What this ADR hides is the stylist and their day, not the
salon's history of who has been in.

**The write path is unchanged.** Nothing checks `active` before a create, a change or a
delete, and nothing is being added. A booking left behind by a deactivation stays editable
by anything holding its id: the planned iOS app, a curl, a later admin screen. The board is
the surface that hides it, not the database.

Reactivating an employee brings the column and every one of their entries back, untouched.
Deactivating is still reversible, because nothing was deleted - which is the half of
ADR-0002 that stands unchanged.

## Consequences

- **An appointment can exist and appear nowhere.** This is the cost, it was named before the
  decision was taken, and it was accepted. Deactivate a stylist who is booked next Tuesday
  and that customer still arrives, with nothing on any screen expecting them. The note added
  to ADR-0002 on 2026-08-12 called exactly this out - "an appointment that exists, is charged
  for, and is invisible" - and this ADR overrules it.
- **A past day no longer reads the way it happened.** A leaver's three customers on a day in
  June are gone from that day, so the board is a record of who is on the staff list now, not
  of what the salon did then.
- **The column count is now a plain function of the staff list.** Every query that builds a
  day gets simpler, and the count no longer depends on what is booked. This is the half of
  the change with no cost attached.
- **Colours shift.** ADR-0009 assigns one colour per customer per day, from the whole day.
  The whole day is now the visible day, so a hidden entry no longer consumes a colour a
  visible customer could have had. Every client still agrees, because the server still
  decides.
- **The exclusion constraint still covers hidden rows.** An inactive employee's time is
  still theirs and still refuses an overlap. Nothing can be booked over it, and nothing on
  the board can be booked into it either, because they have no column.
- `docs/PRODUCT_BRIEF.md` said under *Done when* that "a deactivated employee's existing
  appointments still render". That line is now false and was amended with this decision, as
  were the two awkward cases that read the same way.
- **Hidden is not unreachable, and no later work may assume it is.** The board does not show
  these rows; the database still holds them, the write path still accepts changes to them, and
  `/api/suggestions` still draws customer names and treatments from them. Anything that needs
  data actually withheld needs authentication - ADR-0004 - not this ruling.

## Alternatives rejected

- **Keep ADR-0002 as it stands.** History stays readable and no appointment is ever
  invisible. Rejected by the owner: the board should follow the staff list, and a leaver
  taking up a column is not what they want to look at.
- **Hide the column but send the entries anyway, listed under the board.** `Board.tsx`
  already renders entries it cannot place, with a reason, so this was nearly free and no
  appointment would have become invisible. Rejected by the owner in favour of the day looking
  as though that person was never there.
- **Refuse to deactivate anybody holding an entry, so the case cannot arise.** Makes the
  invisible-appointment problem impossible, and makes a routine admin action fail with
  homework attached. It also needs a database trigger, since there is no employee write path
  to put a check in. Rejected by ADR-0002 already, on the same grounds.
- **Refuse writes for an inactive employee as well.** Consistent with the board. It also
  locks those rows permanently, so cancelling next Tuesday's leftover booking becomes a
  hand-written statement against the live database - which is how a production database gets
  edited by hand at the worst possible moment.
