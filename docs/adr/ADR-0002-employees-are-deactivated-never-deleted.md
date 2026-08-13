# ADR-0002: Employees are deactivated, never deleted

- Status: accepted, with the visibility rule superseded by
  [ADR-0012](ADR-0012-a-deactivated-employee-leaves-the-board-entirely.md) on 2026-08-13
- Date: 2026-08-12

**Read ADR-0012 before this one.** Deactivate-never-delete stands, and so does everything
here about not destroying a booking as a side effect of an administrative action. What no
longer holds is the visibility rule: an inactive employee keeps no column on a day they have
entries, and those entries no longer reach the board at all. The paragraphs below that say
otherwise are kept as written, because they record why it was decided that way first.

## Context

Staff are managed inside the application, so somebody will eventually remove one. That
person will usually have appointments booked against them, and may have years of past
days recorded.

Deleting the row is the simple implementation. It is also the one that destroys a
customer's booking as a side effect of an administrative action, and makes past days
render wrongly or not at all.

## Decision

Removing an employee marks them inactive. Nothing is deleted.

An inactive employee gets no column on days where they have no appointments, and can
no longer be assigned new ones. Every appointment already booked against them stays
exactly where it is, and any day that contains one still renders their column so the
day reads correctly.

## Consequences

- History stays readable. A past day looks the way it looked when it happened.
- The column count on a given day is derived from who is active plus who has
  appointments that day, not from a simple list of active staff. Every query that
  builds a day has to account for this.
- Inactive employees accumulate. If the staff list ever gets long enough that this is a
  problem, the fix is a filter in the management screen, not deletion.
- Nothing here deletes personal data on request. If that becomes a requirement, it is a
  separate, deliberate mechanism, not a side effect of removing a colleague.

## The column count is a consequence of this, not a setting

Added 2026-08-12, after a request to make columns hideable was interviewed and turned out to
need no code.

**The board draws a column per active employee, and that is the whole rule.** Four stylists
means four columns; a fifth appears the day a fifth person is added, and the board scales to
six without anybody configuring anything. The count follows the staff list because of the
`active` flag this ADR introduced, so there is nothing separate to keep in step with it.

A per-column show and hide control was considered and rejected as machinery for a problem
that does not exist. If it is ever revisited, the interview surfaced one rule it would have to
obey: **a column holding an appointment may not be hidden.** A hidden column with a real
booking in it is an appointment that exists, is charged for, and is invisible - the customer
arrives and nobody expects them. That is the same call this ADR already makes for deactivated
staff, who keep their column on any day they have entries.

## Alternatives rejected

- **Block removal until the employee's future days are clear.** Predictable, and it
  makes a routine admin action fail with homework attached. It also does nothing for
  past appointments.
- **Delete the employee and their appointments.** Simple, and it destroys customer
  bookings and the record that they ever existed.
