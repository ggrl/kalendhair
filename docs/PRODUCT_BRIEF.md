# Product brief: single-day salon appointment board

Written 2026-08-12, from an interview (`/grill-me`). Everything here was answered by
the person who wants the thing, except the Mechanism section, which is mine and is a
hypothesis open to being disproved.

## Actor

The person on the salon front desk with a phone to their ear, and the stylists, each
checking the day from their own machine. Desktop or laptop, mouse.

## Observation

The salon runs the day on paper. When somebody else needs to see it, they photograph
the page and send the picture. Existing calendar products were tried and rejected as
not flexible enough.

So the failure is not scheduling - paper does that well. It is that a photograph is a
dead copy the moment it is sent, and nobody holding one can tell how stale it is.

## Outcome

One authenticated page, behaving as close to the paper page as a screen allows, that
every member of staff can open instead of waiting for a photograph, showing the same
truth on every machine, and that cannot show a stylist in two places at once.

The paper's flexibility is the thing to protect. That is why treatment is free text
and there are no fixed slots: the product they rejected was the one that made them
work its way.

## Mechanism - hypothesis, not a decision

Keep the repository's existing Vite, React and TypeScript toolchain for the front end.
Behind it, one long-running Node server that serves the built assets and answers the
API, plus a Postgres database. Both run as services under `docker compose`, with the
database on a named volume, so the same compose file runs on a laptop for testing now
and on a VPS later. A single shared salon password exchanged for a signed, httpOnly
session cookie.

Self-hosted containers, not a managed platform and not serverless. See ADR-0005.

The board is a CSS grid of 15-minute rows from 06:00 to 20:00, one column per active
employee, with absolutely positioned appointment boxes: drag to create, drag to move
across time and columns, edge-drag to resize, a modal for customer, treatment and
notes, and notes rendered only when a box is clicked. Customer and treatment are free
text with autocomplete drawn from previous entries, so there is no list to maintain.

Boxes are coloured, one colour per distinct customer per day, so a customer split across
two appointments - the dye sets while somebody else is cut - is visibly one person in two
places. The colour is computed by the server from the whole day, never stored, and grey
is kept out of the palette. See ADR-0009.

A checkbox in the same modal makes the row a grey block instead of an appointment:
time nobody may be booked into, with no customer, no treatment and no label. A checkbox
beside a column heading blocks that employee's whole day, which is one block row from
06:00 to 20:00 and nothing more. Blocks live in the same table as appointments, because
that is the only way the verified overlap constraint can cover both. See ADR-0008.

The board polls for the day being viewed and swaps boxes in place. Polling, not
server push. The original reason for that no longer holds: it was that a serverless
function may not be able to keep a connection open, and a long-running Node server
plainly can. So the choice now rests on simplicity alone - a salon board is not a
trading floor, and polling survives proxies, sleeping laptops and dropped wifi with no
reconnection logic to get wrong. Push is available whenever polling proves not to be
enough. Updating data must never change which day is on screen, and the date lives in
the URL so a refresh, a crash or a redeploy returns to the day the person was actually
on.

An iOS app is expected later, showing the same calendar. It is not built here and
nothing waits for it, but two schema decisions are made now because they are the
expensive ones to reverse afterwards.

The API is the only door to the data. No client connects to Postgres, ever, native or
not: the server is the sole process holding a database connection, and the database port
is not published outside the compose network. So the API is shaped by what a calendar
client needs rather than by what the React components happen to hold. See ADR-0006.

Times are stored as salon-local wall clock: a date plus a start and end time in the
salon's own timezone, rendered in salon time by every client no matter where the device
is. The salon's timezone is explicit configuration, never inferred from the server, the
container or the phone asking. A stylist checking the board from another country sees
the salon's 10:00, not a convincing 09:00. See ADR-0007.

The app is assumed online-only, so ids are server-generated, deletes are deletes, and
there is no change-tracking or conflict-resolution machinery in the schema. If offline
editing is ever wanted, that is a schema change and a new ruling, not a feature.

Both hard rules live server-side, because a rule enforced only in the browser is not
enforced:

- Overlap is a database constraint, not a read-then-write check. Two simultaneous saves
  can both pass a check, and that was demonstrated rather than assumed: without the
  constraint, two concurrent transactions each counted zero clashes and both inserted,
  double-booking one stylist. Postgres refuses it via an exclusion constraint. The
  verified schema, and the zero-length hole that testing exposed, are in ADR-0001.
- A save carrying a stale version stamp is refused, not merged. This stays even with a
  live board, as the backstop for two people editing one box inside a single polling
  interval.

## Examples

Ordinary: drag 10:00 to 11:00 in Marco's column, type "Anna Schmidt", "Colour", save.
The box reads 10:00 - 11:00, Anna Schmidt, Colour.

Awkward, each needing an answer in code:

- a drag that ends where it started
- a drag onto occupied time in the same column
- a resize that runs into a neighbour
- a 15-minute box too short to fit three lines of text
- a customer name that overflows a narrow column
- six columns on a laptop screen
- a day with no active employees
- the same appointment edited from two machines
- an update arriving mid-drag, which must not yank the box out from under the cursor
- an appointment deleted elsewhere while its modal is open here
- a deactivated stylist's past day
- autocomplete on the very first appointment, when there is no history to draw on
- a day with more distinct customers than the palette has colours, where two strangers
  will share one and look like a pair
- the same name typed with different capitalisation or a stray space, which must still
  count as one customer
- ticking the whole-day block on a column that already has appointments, which is refused
  and has to say what is in the way
- a block dragged over an appointment, and an appointment dragged over a block
- unticking the whole-day box
- a block on a deactivated employee's column
- text staying readable on a coloured 15-minute box

## Non-goals

Deliberately not doing, and each one will feel missing before it is missed:

- customer records, phone numbers or history - a customer is a text string
- per-stylist working hours or breaks: the full 06:00-20:00 is bookable for everyone
- customer-facing online booking
- reminders by SMS or email
- recurring appointments
- prices, payments or till
- mobile or touch support
- printing, which is worth naming given they are coming from paper
- the iOS app itself, and any offline capability in it. Expected later, planned for in
  the schema only, and nothing in this build waits for it

## Two stages, and the condition between them

**Stage one, now.** Runs locally under `docker compose` on one machine, for testing.
Fake data only. No backups, no TLS, not reachable from the internet.

**Stage two, later.** The same compose file on a VPS, behind a domain with HTTPS,
because ADR-0004 puts one shared password in front of everything and over plain HTTP
that password, the session cookie and every customer name travel readable across every
network in between, salon wifi included.

**The condition between them is backups, and it is blocking.** Deferring them is
correct while the data is fake and wrong the moment it is not. Paper survives a dead
disk; a container does not. Today, losing the book costs a photo thread. After this, it
means the salon does not know who is coming tomorrow.

So, written down here so it is not remembered on the day it stops being true: **before
the salon puts one real appointment in, there must be a backup that leaves the VPS on a
schedule, and one restore that has actually been performed, not merely documented.** An
untested backup is a belief, not a backup.

## Permissions

May create `src/`, `tests/`, the `/api` backend and `docs/`, and delete the
placeholder page and both placeholder tests.

May not commit to `main`. May not put the salon password, a connection string or any
other secret in a tracked file. May not use real customer names in test data or seeds.

## Done when

On a branch, `npm run verify` and the browser suite green in CI, the whole thing
running from a clean `docker compose up` on a machine that has never run it before,
with automated tests asserting specifically:

- an overlapping save is refused by the server, not only by the browser
- a save carrying a stale version stamp is refused
- a deactivated employee's existing appointments still render
- notes stay hidden until a box is clicked
- an unauthenticated request for a day returns no customer data
- the day on screen does not change when new data arrives
- a day renders in salon time when the client's own timezone is set to something else
- an appointment overlapping a block is refused by the server, and so is a block
  overlapping an appointment
- two appointments for one customer on one day come back in the same colour, and that
  colour is not grey
- the same name differing only by case or surrounding whitespace gets one colour
- a whole-day block on a column with existing appointments is refused and names the clash

And then the thing no test provides: the salon runs a real day on it and says what is
wrong with it.

## Settled rulings

Nine decisions from this interview are recorded in `docs/adr/` so a later session
cannot quietly re-decide them: no-overlap per employee, deactivate-never-delete for
staff, refuse-the-stale-save, shared-password authentication, self-hosted containers
rather than a managed platform, the API as the only door to the database, salon-local
wall clock time, one table for appointments and blocks, and per-day colour assignment.

Two carry unfinished business, flagged in the ADRs themselves rather than left to be
rediscovered:

- **ADR-0004** is accepted for the web board but marked to be revisited before any
  authentication is written, because a planned iOS app puts the shared password on
  personal phones that leave the building.
- **ADR-0001** rested on an unread claim about what Postgres can enforce. That is now
  settled: read in the documentation and proved against PostgreSQL 17.10, including the
  concurrent case and a zero-length hole the test exposed. The verified schema is in the
  ADR.
