# ADR-0023: What a box says about itself

- Status: accepted and built, 2026-08-15
- Sits under [ADR-0014](ADR-0014-a-block-may-say-why.md), which settled what a *block* may say, and
  beside [ADR-0009](ADR-0009-appointment-colour-is-assigned-per-day.md), which owns the colour

## Context

The stylists asked for a visual clue for how long an appointment runs, "without guessing the lines
or calculating the time". A board of quarter-hour rows makes length a counting exercise: 10:15 to
11:00 is three lines, and the box says so only if you subtract one number from the other.

The corner where such a clue would go was occupied. It held the word `Notiz`, which marked an
appointment that has something written about it - the marker exists because the note's *text* is
deliberately nowhere on the board, after a tooltip once revealed an allergy note to whoever was
standing at the desk.

## Decision

**Every box says how long it lasts.** `15m`, `45m`, `1h`, `1h15` - minutes below an hour, bare
hours with no `0m` after them, no space inside the value. `formatDuration` in `src/calendar/grid.ts`
decides the format, once, next to the rest of the time arithmetic.

**Blocks say it too.** The owner's call, against a recommendation of appointments only: one rule for
every box on the board rather than a rule with an exception.

**It is computed from the slots being drawn, not from the entry's own times.** Mid-drag the box
already reads out the time it is being dragged to, so that somebody sees the appointment they are
about to have; its length is part of that.

**Top right, or on the line when there is no corner.** A 15- or 30-minute box is one or two lines
tall and has no corner that is not also the line, so the value rides the line, pushed hard right
with `margin-left: auto`. Same place to the eye either way, and no reserved padding to hand-tune.

**A note is a folded corner** - `.entry__fold`, 15px, `--ink`, in the box's own bottom-right corner,
drawn with borders so it reads as the page being folded. `aria-hidden`, with the word `Notiz`
surviving as `visually-hidden` text beside the duration.

## What was rejected, and why

**The word `Notiz` in the corner.** It was the widest thing there and the reason the duration had
nowhere to go.

**A dot.** Built, shipped, and reversed within the session on the owner's judgement of the running
board: at 10px on a pastel box it "read as a speck of dirt" rather than as a clue. Recorded here so
the next session does not try it again as an obvious improvement.

**An asterisk**, which rides above the baseline and promises a footnote that does not exist, and **a
drawn note icon**, which says what it is but costs ~14px of a corner the duration already occupies.

**Colour alone**, at any size: presence-versus-absence has to survive a colour-blind reader, so the
signal is a shape.

**Leaving the marker as a character at all.** The fold is not a glyph; it changes the box's outline,
which is what makes it readable at 15 minutes.

## Consequences

**On a 15-minute box the fold clips the tail of `15m`.** Shown to the owner at four times scale
before it was built and accepted deliberately.

**The word `Notiz` is now load-bearing and invisible.** It is the only thing a screen reader gets -
a shape says nothing - so hiding it with `display: none` would take the signal away entirely, and a
test asserts it occupies one pixel while still being in the accessible name. `visually-hidden` in
`src/styles.css` exists for this and is the first use of it.

**The note's text is still nowhere on the board**, including in the `title` and in the accessible
name. A security pass verified that after these changes.

**A long name on a short box does not get an ellipsis**, whatever the stylesheet's leftover rules
suggest: `.board__scroller` is `width: max-content`, so the column grows and the board scrolls
sideways instead - ADR-0021 choosing scrolling over squeezing. What is asserted is that the duration
stays inside the box and to the right of the name.
