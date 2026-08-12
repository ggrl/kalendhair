# ADR-0002: Employees are deactivated, never deleted

- Status: accepted
- Date: 2026-08-12

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

## Alternatives rejected

- **Block removal until the employee's future days are clear.** Predictable, and it
  makes a routine admin action fail with homework attached. It also does nothing for
  past appointments.
- **Delete the employee and their appointments.** Simple, and it destroys customer
  bookings and the record that they ever existed.
