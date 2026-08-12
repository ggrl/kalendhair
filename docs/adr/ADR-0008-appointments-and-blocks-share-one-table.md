# ADR-0008: Appointments and blocks share one table

- Status: accepted
- Date: 2026-08-12

## Context

Employees need to mark time they are not available: a lunch, a course, a holiday, or a
whole day off. A checkbox in the appointment modal creates a grey block instead of an
appointment, and a checkbox beside a column heading blocks that employee's whole day.

A block is not an appointment. It has no customer and no treatment, and it renders grey
rather than coloured. The obvious implementation is therefore a second table.

That is the wrong instinct, for one concrete reason. The rule that matters is that
nothing may be booked over a block, and ADR-0001 puts exactly that class of rule in a
Postgres exclusion constraint, verified. **An exclusion constraint cannot span two
tables.** Split appointments and blocks apart and "no appointment may land on a block"
becomes application code doing a read-then-write check - the precise thing that was
demonstrated to lose the race in ADR-0001, where two concurrent transactions both saw a
clear slot and both wrote.

## Decision

One table. A row has a kind: an appointment or a block. The exclusion constraint from
ADR-0001 covers the table, so it already enforces every combination:

- an appointment may not overlap an appointment for the same employee
- an appointment may not overlap a block
- a block may not overlap an appointment
- a block may not overlap a block

None of those need a line of application code, and none can lose a race.

Consequences for the columns: customer and treatment are meaningful only for
appointments. They are nullable, with a check tying them to the kind, so a block cannot
carry a customer name and an appointment cannot be missing one.

**Blocking a whole day is one block row from 06:00 to 20:00.** Not a new concept, not a
flag on the employee. It follows that ticking the box on a column that already has
appointments is refused by the existing constraint, which was the chosen behaviour: the
customers in the way have to be called and moved, and a tool that quietly hid them would
be lying about a day nobody is working.

## Consequences

- One rule, one home, enforced by the database for every combination of kinds.
- A block carries no label. It is a grey area with no text, which was chosen
  deliberately: nobody reading the board can tell a holiday from a course from a mistake
  somebody made last week. If that turns out to matter, the treatment column already
  exists and this is the ADR to supersede.
- Every query that draws a day returns both kinds and the client renders them
  differently. Nothing that reads the table may assume a row has a customer.
- Grey is reserved for blocks and never appears in the customer palette, or a block
  becomes indistinguishable from an appointment. See ADR-0009.
- Unticking the whole-day box deletes that block row. It does not restore anything,
  because nothing was destroyed to create it.
- The API exposes one collection with a kind, not two endpoints. A future iOS app
  inherits every rule above without re-implementing any of it.

## Alternatives rejected

- **A separate `block` table.** Cleaner-looking schema, and it moves the only rule that
  matters out of the database and into application code with a proven race. Rejected.
- **A flag on the employee for a day off, rather than a row.** Avoids one wide row per
  blocked day. It also creates a second thing the overlap rule has to consult, which the
  constraint cannot see, so booking against a day off would again become application
  code. Rejected for the same reason.
