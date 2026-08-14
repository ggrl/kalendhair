# ADR-0022: The day steps are quiet strips, not hot zones over the board

- Status: accepted and built, 2026-08-15
- Narrows the arrangement described in [ADR-0021](ADR-0021-the-board-on-a-phone.md), which gave the
  board its own scrollport and the page none of it. That rule is what rules out the design below.

## Context

Previous and next day are two full-height strips pinned to the outer edges of the screen. They are
the **only** control that moves one day: the top bar's `Vorige Woche` and `Nächste Woche` move a
week, `Heute` jumps to today, and the picker jumps to a date.

The owner had seen an online presentation app where the cursor turns into an arrow near the edge of
the screen and a click there moves to the next slide, and asked what it would cost to work that
way - with the two visible buttons removed entirely.

## Decision

**The buttons stay buttons.** No box is drawn - no border, no fill, only the chevron - and the
cursor over one is a one-way arrow. They keep their `aria-label`s, their place in the tab order and
their focus ring, and the nineteen test call sites that drive the application by those names keep
working.

**They are sized `clamp(1.75rem, 100vw - 1280px, 9rem)`.** Below 1280px they are the 28px sliver
they always were; past that they grow a pixel per pixel of screen, to 144px. The chevron follows the
same measure at a third of the rate, `clamp(1.5rem, (100vw - 1280px) / 3, 3rem)`, so it grows only
where the strip grew and a phone keeps exactly the glyph it had.

**The cursor is drawn here rather than named.** CSS has no one-way arrow cursor: the nearest
keywords are `w-resize` and `e-resize`, which an operating system is free to draw as a
double-headed arrow meaning "drag to resize". It is an inline SVG, white under black, hotspot at the
tip, with the resize keyword as the fallback.

## What was rejected, and why

**A true hot zone - an invisible strip laid over the board's own edges, click to move.** Priced and
ruled out before any code, for reasons that are about this board and not about taste:

- [ADR-0013](ADR-0013-a-drag-is-the-edit-and-it-commits-on-release.md) makes a drag the edit. A
  create-drag starting near the left or right edge would be swallowed by the navigation zone.
- The left edge is the hour scale and the right edge is the last stylist's column. Both are places
  people press on purpose.
- There is no hover on a phone, so the arrow would never appear there; a tap near the edge is
  ambiguous with the sideways scroll ADR-0021 gave the board; and the strips are 28px, already under
  the 44px a thumb wants. The gesture would be worse than neutral on touch, not merely absent.

**Reaching the true viewport edge on a screen wider than the 1600px shell.** It would take nothing
from the board, but the shell would have to span the viewport with the top bar capped separately -
layout surgery on a bar that is three review findings deep, for a strip that is already 144px.

**Keeping the finger cursor**, which is the honest signal for "a button that navigates" and is what
every other control uses. Rejected because it is exactly the promise the owner asked to change.

## Consequences

**The width comes off the board.** At 1440px four stylists keep columns well over the 150px
minimum. A salon of eight at that width starts scrolling sideways sooner than before - ADR-0021's
minimum giving way to scrolling rather than to squeezing, which is what that rule chose. Both cases
are asserted in `tests/edges.browser.test.ts`.

**How the cursor looks is unverified.** A cursor is drawn by the operating system and Playwright
cannot screenshot one, so the tests assert which cursor was declared and nothing more. The owner
judged the picture on a real screen and accepted it; nothing in the suite would catch it changing
into something ugly on another platform.

**The focus ring is now load-bearing.** With no box drawn it is the only thing that shows a keyboard
user where they are, so the stylesheet deliberately does not touch it and a test asserts it is not
`none`.
