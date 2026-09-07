# ADR-0026: The grid rules the hour and shades the working rows

- Status: accepted and built, 2026-09-07
- Sits beside [ADR-0015](ADR-0015-core-hours-shade-the-board-and-refuse-nothing.md), which owns the
  grey wash over the hours the salon does not work, and amends its colour
- Same origin as [ADR-0023](ADR-0023-what-a-box-says-about-itself.md): the stylists used the board
  and said what was hard to read

## Context

The salon was shown the board and wants to use it. Two things were hard to read, both about the
grid rather than about the appointments on it.

**The hour was not findable.** The stylists said the thick lines were only "at 10:00 and 17:00".
That was not a setting somebody had got wrong. The hour rule was 1px, exactly as wide as a
quarter-hour rule and only darker, and a row was `1.1rem` - 17.6px, which makes an hour 70.4px. A
1px rule at a fractional offset is smeared across two pixels at part strength, so which hours
looked ruled depended on where `70.4 x n` happened to land near a whole pixel. Measured on the
running board as ink, meaning how much darker than paper, summed across each rule:

```
1.1rem:  30 59 52 42 61 38 55 57 35 61 47 51 61 40    spread 31
```

A quarter rule measures 26 to 27. So the weakest hour rule was 1.11x a quarter rule - the same
line, to the eye - and the strongest was more than twice it. **The unevenness was the complaint;
the two hours they named are screen-dependent and are not the point.**

**A row could not be followed across the columns.** Six columns of 15-minute rows with nothing
separating one row from the next, which is a job paper does with a printed line and a screen was
not doing at all.

## Decision

**The hour rule is 2px, and it is painted on top of the quarter rule.** Both are background
gradients on `.board__column`; the hour one is listed *first*, because the first image in a
`background-image` list is the one painted over the others. Listed second it lost its top pixel to
the quarter rule and measured 97 ink instead of 138.

**A row is `1.09375rem`, so an hour is exactly 70px.** Not a taste change: it is what makes every
hour rule identical. All fourteen now measure 138 ink, spread 0, which is 5.11x a quarter rule. The
board is 5.6px shorter than it was and nothing else about it moved.

**The 15-minute rows alternate, inside the salon's working hours and nowhere else.** One element,
`.board__rows`, spanning the open stretch. It takes no pointer events, because it lies over the part
of the day where nearly every appointment is made.

**It leaves `z-index` alone, which is the opposite of the wash above it.** A grid item with an
explicit `z-index` paints after the ones that leave it `auto`, so the `z-index: 0` this was first
written with - copied from `.board__closed` - put the stripes on top of the columns and their rules.
Left `auto` it paints in tree order, before the columns. Measured on a quarter rule sitting on a
half-pixel boundary: rgb(239) with no stripes, rgb(232) with them on top, rgb(235) with them
underneath.

**That rule still moves by three, and painting order cannot fix it.** A rule on a half-pixel
boundary is antialiased, so it is partly transparent and whatever is behind it shows through. Order
buys half the effect, not immunity - which matters the day somebody wants a darker `--row-shade`.
**The hour rules are untouched either way**, rgb(184) with the stripes on or off, and not because of
paint order: every hour boundary is an even slot, so it lands in the transparent half of the tile
and has nothing over it to blend with.

**The stripe pattern is anchored to the clock, not to the opening time.** 06:15 is shaded, and so is
every odd quarter after it, whether the salon opens at 09:00 or at 09:15. The tile starts at the
band, so an odd opening slot gets it shifted down one row to put the phase back.

**The wash over the closed hours darkens from 7% to 10% black**, so that "working" and "not working"
stay a glance apart now that the working half is no longer plain paper. Over paper the three greys
land on rgb(245) for a shaded row, rgb(233) for a closed hour and rgb(212) for a block, lightest to
darkest in that order. ADR-0015 already records that its ruling "was never about which colour", so
this amends that ADR rather than superseding it.

## What was rejected, and why

- **Alternating every 30 minutes, or every hour.** Both were built and looked at. Every hour is the
  calmest and mostly repeats what the new thicker rule already says; every 30 minutes reads well
  and lands the eye on `:00` against `:30`. The owner chose every 15 minutes, which is the finest
  and the strongest help for counting quarters, having seen all three.
- **Thickening the hour rule and leaving the row height alone.** The cheap half, and it does not
  answer the complaint: measured at 2px on a 70.4px pitch the spread is still 99, so the hours
  would still be uneven, just uneven and thicker.
- **Striping the closed hours too.** Two greys arguing about the same rows. Outside the working
  hours the wash is already saying something, and the point of the stripes is to help read the part
  of the day that is in use.
- **Anchoring the stripes to the opening time** rather than to the clock. Simpler - no shift, no
  parity - and it makes the pattern differ by weekday for a reason no stylist could see: 09:15
  shaded on a day that opens at 09:15 and white on a day that opens at 09:00.
- **Making the row height a whole number of pixels rather than a rem value.** It would hold the
  hour pitch at any text size, and it would stop the rows growing with the salon's own font
  setting, which is a worse trade for a board whose boxes hold three lines of text.
- **Darkening the closed wash further** for more separation. It paints *over* the column rules, not
  behind them: at 10% a quarter rule already reads rgb(209) instead of rgb(226) and an hour rule
  rgb(171) instead of rgb(184). Every extra percent dims the grid that ADR-0015 says this fill must
  leave readable.

## Consequences

- **A day the salon does not work has no stripes at all.** `openBand` returns null for a Sunday, a
  Monday and a Hessen holiday alike, because they all arrive as `coreHours: null`. There is no white
  part for stripes to alternate against, so this is correct rather than a missing case.
- **Two edges have to agree.** The stripes stop exactly where the grey wash starts, so `openBand`
  and `closedBands` both take their slots from one `clampedBand`. That guarantee started out held by
  two copies of the same four lines plus a comment defending them, which is not a guarantee; it is
  now held by there being one copy.
- **A test has to look at the colour, not only at the geometry.** The first version of these tests
  asserted the overlay's count, rows, size and position, and `--row-shade: transparent`,
  `background-image: none` and an alpha *darker than the closed wash* all passed every one of them -
  `background-size` still computes to `100% 35px` with no image at all. The salon's actual condition,
  that the shaded row stays lighter than a closed hour, is now asserted by comparing the two alphas.
- **Two lists have to agree.** The gradients in `styles.css` and the sizes `Board.tsx` hands them
  are in the same order. Swapping one without the other sizes the hour rule to a quarter row, which
  draws a 2px rule every fifteen minutes. A test asserts the order, not only the widths.
- **The hour pitch is whole pixels only at the default text size.** Somebody who enlarges text makes
  it fractional again and the unevenness returns. No rem value can prevent that, and it is written
  down rather than promised away.
- **The landing scroll is now floored.** It aims 08:00 exactly flush with the bottom of the sticky
  headings, which is a knife edge; the changed row height put it 0.41px high, tucking the label
  under an opaque element. Flooring can only ever leave it below. The knife edge was there before
  this change and this is what exposed it.
- **Nothing about the write path, the constraint, the colours of the boxes or the drag rules moves.**
  The board draws one more thing and gained no rule, exactly as ADR-0015 said of itself.
