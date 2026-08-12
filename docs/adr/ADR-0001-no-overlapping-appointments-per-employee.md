# ADR-0001: An employee's appointments may never overlap

- Status: accepted
- Date: 2026-08-12

## Context

Google Calendar allows overlapping events and renders them side by side, splitting the
column. That is the behaviour most people expect from a calendar, and copying it here
is the obvious move.

It is wrong for this product. Google books rooms and people who genuinely can be
double-booked. A salon chair cannot. One stylist with two customers at 10:00 is not a
layout problem to be rendered prettily - it is a mistake somebody will discover when a
customer is standing in the shop.

## Decision

An appointment may not overlap another appointment for the same employee. The save is
refused and the reason is shown.

Enforcement is server-side. A check in the browser is a convenience, not a rule: it can
be bypassed, and it cannot see a save arriving from another machine.

A read-then-write check is not sufficient either. Two saves arriving at once can both
read a clear slot and both write. The intent is a database constraint, so the database
settles the race.

That was a hypothesis when this ADR was written. It has since been read in the
documentation and proved against a running database. See the section below.

## Verified mechanism

Confirmed twice: read in the documentation, then run against PostgreSQL 17.10 in a
throwaway container. Not inferred.

PostgreSQL's own range types documentation gives almost exactly this case, a meeting
room that may not be double-booked:

> You can use the `btree_gist` extension to define exclusion constraints on plain
> scalar data types, which can then be combined with range exclusions for maximum
> flexibility. For example, after `btree_gist` is installed, the following constraint
> will reject overlapping ranges only if the meeting room numbers are equal

The shape that was tested, with the employee standing in for the room. Start and end
stay separate columns so the API sends plain times per ADR-0006; the range is an
expression in the constraint, not a stored column:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE appointment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  starts_at   timestamp NOT NULL,   -- salon wall clock, ADR-0007
  ends_at     timestamp NOT NULL,
  customer    text NOT NULL,
  CONSTRAINT appointment_positive_duration CHECK (ends_at > starts_at),
  EXCLUDE USING gist (
    employee_id WITH =,
    tsrange(starts_at, ends_at, '[)') WITH &&
  )
);
```

What the run established, each case executed rather than reasoned about:

- An overlapping insert for the same employee is refused. A fully contained one is
  refused. The same time for a *different* employee is accepted.
- **Adjacent appointments are accepted.** 11:00-12:00 books cleanly after 10:00-11:00,
  because the `[)` bounds make the upper end exclusive. This is not incidental - a
  15-minute grid is nothing but adjacent appointments, and inclusive bounds would have
  made every back-to-back booking a false clash.
- A 15-minute booking, the smallest the product allows, is accepted.
- `UPDATE` is covered by the same constraint. Moving a box to another employee's column
  or another time is refused if it lands on a clash, so drag-to-move needs no separate
  rule.
- `btree_gist` is required, for the `employee_id WITH =` half. The first migration has
  to create the extension.
- `gen_random_uuid()` needed no extension on 17.10.

### The constraint alone is not enough, and the test is what found it

A **zero-length appointment evades the exclusion constraint completely.** An empty range
overlaps nothing, so `10:30-10:30` was accepted and stored *inside* an existing
10:00-11:00 booking. The board would have rendered an invisible appointment in an
occupied hour.

This is not theoretical. The brief already lists "a drag that ends where it started" as
an awkward case, and that gesture produces exactly this row.

`CHECK (ends_at > starts_at)` closes it, and was re-run to prove it: the zero-length
insert is now refused, and adjacent and 15-minute bookings still pass. The same check
also catches a backwards appointment with a clear message. Without it, backwards times
do error, but as `range lower bound must be less than or equal to range upper bound`,
which is the database's internals talking, not a rule anyone would recognise.

**The positive-duration check is part of this ruling, not a nicety.** The exclusion
constraint without it has a hole big enough to store an appointment in.

### Read-then-write really does lose the race

Proved rather than assumed, at PostgreSQL's default `read committed` isolation, which is
what an application gets unless it asks otherwise:

- **With the constraint:** two concurrent transactions inserting overlapping rows for
  one employee. The second blocked until the first committed, then failed with
  `conflicting key value violates exclusion constraint` and rolled back. One row
  survived.
- **Without it, using a check-then-insert in each transaction:** both transactions
  counted zero clashes, both inserted, and the employee ended up double-booked
  14:00-15:00 and 14:30-15:30. Two rows survived.

The second case is exactly what application-level validation does, and it is the reason
this rule lives in the database.

## Consequences

- The calendar catches a real-world error instead of displaying it. That is the point.
- A stylist who genuinely runs two customers at once - colour processing on one while
  cutting another - cannot record it. This was raised in the interview and accepted.
  If it turns out to be common, this ADR is what to supersede.
- Every write path pays the constraint: create, drag to move, and edge-drag to resize
  all have to handle a refusal, including mid-drag.
- The refusal arrives as a Postgres error naming the constraint, not as a sentence
  anybody wants to read. The server has to turn it into a message about a stylist
  already being booked, and it has to distinguish the two constraints: an overlap and a
  zero-length drag are different mistakes.

## Alternatives rejected

- **Allow and render side by side**, as Google does. Flexible, and the tool would then
  never tell you that you had made a mistake.
- **Allow but warn.** Keeps the flexibility and makes the clash visible. Rejected
  because a warning seen every day stops being read.
