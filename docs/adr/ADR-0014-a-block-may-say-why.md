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

**The box reads `N/A`, and the reason goes behind it: `N/A Urlaub`.** A block with no reason reads
`N/A` alone. A reason nobody can see without opening the box is worth less than the marker beside
it, which is why it is drawn rather than filed away.

Amended the same day, twice. This first said the reason *replaces* the word `Gesperrt` - the owner
asked instead for a marker that always stands with the reason qualifying it, and for that marker to
be `N/A` rather than a German word. So `Gesperrt` is gone from the board altogether.

That leaves ADR-0011 with an exception, and it is deliberate: `N/A` is not German, and it is not
prose either. It is a symbol on a grey box, chosen by the owner, and the German did not survive
because there is no short German equivalent that reads as a marker rather than a sentence. The
prose that a screen reader and a hover tooltip get is still German - see below - so the exception is
to the label, not to the language.

**It is its own column, not `notes`.** An appointment's notes are private and deliberately
never drawn on the board: a customer's allergy note reached the screen once, and three review
passes caught it. A reason is the opposite - it exists to be read at a glance. One column
carrying both rules is how the hidden one gets shown by accident, and the check constraint
would no longer be able to say which kind may carry what.

**Blank is refused, in the database.** "Nothing said" is NULL, exactly as it is for a
customer. A box labelled with a space would look like a fault nobody can find.

**The tooltip and the accessible name are German prose and always say `gesperrt`:**
`14:00-15:00 gesperrt: Urlaub`. The hatched grey is the only other thing that says this is blocked
time, and a screen reader cannot see it - and `N/A` read aloud says even less than `Gesperrt` did.
The `aria-label` is therefore set on every block, not only on labelled ones.

This was false when first written, and a review pass measured it: `title` supplies an accessible
name only when an element has no text content, and this button has plenty. The name was
`14:00-15:00 Urlaub`, which is what an appointment for a customer called Urlaub sounds like. It
takes an explicit `aria-label`.

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
- **Unticking a whole-day block that carries a reason opens it instead of deleting it.** Until this
  ADR the tick destroyed nothing it could not recreate identically, so it needed no confirmation
  while the modal's `Löschen` did; a review pass found one click deleting typed text with nothing
  asked and nothing on screen hinting there was anything to lose. A labelled block now opens in the
  form, where deleting already asks first. A bare one still just goes.
- **Changing an entry's kind drops the other kind's text, on save, with no warning.** Ticking
  `Sperrzeit` on an appointment sends `notes: null`; unticking it on a block sends `reason: null`.
  The fields leave the screen the moment the box is ticked, so what is about to be lost is not
  visible at the moment `Speichern` is pressed. Accepted rather than fixed: the state survives in
  the dialogue, so re-ticking within the same form restores it, and the alternative is a warning on
  a gesture that is nearly always deliberate. Written down here because a review pass had to
  discover it, which is the wrong way to learn it.
- **A short block puts its reason on one line with the start time.** A 15-minute box is 15.6px
  tall and a second line starts below its bottom edge, so `Zahnarzt` on the shortest block the grid
  allows was drawn nowhere at all - the promise above, broken in the case that needed it most. Same
  answer the appointment path already used, and a long reason ends in an ellipsis rather than a
  mid-letter cut.
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
