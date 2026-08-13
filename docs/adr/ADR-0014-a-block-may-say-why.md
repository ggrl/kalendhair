# ADR-0014: A block may say why, in its own field, on the box

- Status: accepted
- Date: 2026-08-13
- Supersedes: the "a block carries no text" half of
  [ADR-0008](ADR-0008-appointments-and-blocks-share-one-table.md)

## Context

ADR-0008 gave a block no text at all: no customer, no treatment, no notes, enforced by
`appointment_fields_match_kind` and refused again in `server/write.ts`. Every grey box on the
board therefore read `Gesperrt` and nothing else, and a day with three of them said the same
word three times.

The owner asked for an optional reason - holiday, training, a dentist - and asked for it **on
the box in place of `Gesperrt`**, not hidden behind a click.

## Decision

**A block may carry a reason. It is optional, and it is the only text a block may carry.** An
appointment may not carry one at all: a treatment is what an appointment is for, and two
fields answering that question would drift apart.

**The reason replaces the word `Gesperrt` on the box.** A block with no reason still reads
`Gesperrt`. A reason nobody can see without opening the box is worth less than the word it
replaced, which is why it is drawn rather than filed away.

**It is its own column, not `notes`.** An appointment's notes are private and deliberately
never drawn on the board: a customer's allergy note reached the screen once, and three review
passes caught it. A reason is the opposite - it exists to be read at a glance. One column
carrying both rules is how the hidden one gets shown by accident, and the check constraint
would no longer be able to say which kind may carry what.

**Blank is refused, in the database.** "Nothing said" is NULL, exactly as it is for a
customer. A box labelled with a space would look like a fault nobody can find.

**The tooltip and the accessible name still say `gesperrt`.** The hatched grey is the only
other thing that says this is blocked time, and a screen reader cannot see it. So the visible
label carries the reason and the title carries both: `14:00-15:00 gesperrt: Urlaub`.

## Consequences

- `migrations/003_block_reason.sql` adds the column and replaces the check constraint. The
  constraint had to be dropped and recreated rather than extended, because it names every
  field a kind may carry.
- A move or a resize carries the reason back unchanged, like every other field a gesture does
  not touch. Without that, dragging a block would quietly erase why the time was blocked;
  `tests/dragging.browser.test.ts` asserts it.
- The whole-day column checkbox still creates a bare block with no reason. Adding one is a
  second gesture - open the box, type it - which keeps the tick a single click that either
  works or is refused.
- **No autocomplete for reasons.** Customer and treatment draw on a rolling year because the
  salon has hundreds of each; the reasons a column is closed are few and short. If somebody
  asks for it, `server/suggestions.ts` is where it goes, and it would need a third field name
  in that endpoint's narrowed union.
- The word on screen is `Grund`, chosen by the owner under ADR-0011.
- ADR-0008 keeps everything else: one table, one exclusion constraint, four combinations, a
  whole day blocked as one 06:00-20:00 row, no customer on a block, no blank customer on an
  appointment.

## Alternatives rejected

- **Reuse the `notes` column and show it for blocks only.** One migration line, no new field.
  Rejected: the same column would be hidden for one kind and drawn for the other, which is
  exactly the shape of the privacy defect this project already had once, and the next person
  who decides to render notes will not know there was a rule.
- **Keep the reason in the form, out of sight, like an appointment's notes.** Cheapest of all,
  and it leaves every grey box looking identical - somebody has to click each one to find out
  which day is a holiday. Rejected by the owner.
- **A reason only on whole-day blocks.** Fewer characters on a crowded board, and a rule with
  an exception in it: there is no good answer to why a one-hour block cannot say `Arzttermin`.
- **A fixed list of reasons.** Predictable, sortable, and precisely the kind of list to
  maintain that the brief says the salon rejected other products for. Free text, like
  everything else here.
