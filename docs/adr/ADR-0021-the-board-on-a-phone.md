# ADR-0021: The board on a phone

- Status: accepted and built, 2026-08-14
- **Reverses the `mobile or touch support` non-goal** in `docs/PRODUCT_BRIEF.md`, and makes
  [ADR-0004](ADR-0004-one-shared-salon-password.md)'s standing warning about personal phones live
  rather than hypothetical

## Context

The owner asked for two things: staff being able to look the board up on a phone, and being able to
add an appointment there in the rare case, accepting that it would be less convenient than the
desk. The first question was whether a `+` button alone would do.

**It would not, and the reason was measured rather than argued.** On an iPhone 13 with six
stylists:

- columns were **55px** and customer names wrapped to three lines, of which some were cut off -
  `Bea Wolff` rendered as `Bea Wolff` with the surname clipped, `Anna Schmidt` as `Anna Schmi dt`;
- the top bar declared `height: 6.5rem` and its content needed more, so at `z-index: 10` with an
  opaque background it painted **over the column headings** at `z-index: 9` - `Marco` appeared as
  `M` above the buttons and `co` below them. Which column belongs to whom is the one thing a board
  must never get wrong;
- the `Notiz` marker collided with the start time, printing `09:00Notiz`.

So looking things up - the common case - was broken, not merely cramped.

## Decision

**Columns get a minimum of 150px, at every width, with no breakpoint.** `minmax(150px, 1fr)`. On a
laptop with six stylists the columns are `1fr` exactly as before and nothing changes; the minimum
only bites when there is not enough room, which also covers a salon that grows to ten people on a
laptop - the brief's own awkward case, in a different place.

**The board scrolls sideways rather than squeezing.** Measured at 150px: a customer name and a
treatment both render in full.

**The board is its own scrollport.** This is the part that is not a stylesheet. A horizontally
scrollable ancestor becomes the scrollport for `position: sticky` in *both* axes, so with the page
as the scroller the column headings stopped pinning - measured at 220px down the board instead of
under the top bar. The shell owns the viewport height and hands the board what the top bar did not
take; the headings pin to the board's own top edge and the hour scale to its left edge.

**The top bar stops declaring a height it cannot keep.** `min-height` rather than `height`, and
`flex: 0 0 auto` so the new column layout cannot squash it back. Nothing depends on that number any
more, because the headings no longer stick to it.

**`+ Termin` appears on every screen, not only narrow ones.** It opens the existing form empty,
with the day on screen already set. It is there for a phone, and it closes a gap that has nothing
to do with phones: ADR-0013 records that there is deliberately no keyboard gesture for dragging, so
until now somebody who cannot use a mouse could not create an appointment at all. This is their
first way in. It is absent, not disabled, on a day with nobody on the board, because the form's
first field is the person.

**A finger never drags a booking.** A tap opens the form - that runs through the same gesture
machinery, since a press that never travels is a click - and a swipe scrolls.

> **What that rule actually prevents is noise, not a lost appointment**, and the difference was
> measured after two mutation tests failed to catch its removal. Chromium claims a touch drag for
> panning and sends `pointercancel`: one `pointermove` arrives first, then the cancel, and that
> holds even when nothing on the page can scroll. So the write was never reachable. But that single
> move is already past the drag threshold, so without the rule every attempt to scroll the board
> that began on top of a box flashes a preview and then raises `Die Bewegung wurde abgebrochen` on
> release - a refusal, in German, for something nobody tried to do, on every scroll. The first
> version of this ADR claimed the rule stopped a silent write. It did not, and the claim is
> corrected here rather than left standing because it sounded better.

## The shared password, now on phones

ADR-0004 said a shared password is reasonable for machines that live in the salon, and warned that
a phone leaves the building, gets lost, and belongs to somebody who may stop working there - with
no way to cut one person off except changing the password for everybody. Its status line says that
warning stands. **This is the change that makes it live**, and the owner accepted it knowingly.

The response, written down so nobody has to invent it under pressure: **`Einstellungen` → a new
salon password.** It exists, it takes a minute, and ADR-0017 makes it end every session in the
salon - the lost phone included. Five people retype it once.

Rejected with it: per-person accounts, which are the correct answer to the warning and are a table
of people, a redone session, screens to manage them and a migration; and keeping phones read-only,
which removes the reason for this change.

## Consequences

- A day sheet - named people and where they will be - now travels on personal devices. That is
  what ADR-0004 calls personal data under GDPR, and the salon is the controller of it. Nothing here
  changes what the API returns; what changes is where it is read.
- The desktop board scrolls inside its own box rather than scrolling the page. Verified as no
  visible change at 1280px with six stylists: no horizontal scrolling, columns wider than the
  minimum, headings pinned exactly as before.
- Anything relying on the page scrolling vertically for the board - `html { scroll-padding-top }`
  and the fixed position of the loading line - now describes a scrollport that is not the one the
  board uses. Neither is wrong today; both are worth remembering.

## Known, accepted, and not fixed here

- **Nobody has held a real phone.** Everything here is an iPhone 13 viewport in Chromium with
  `hasTouch`, driven by CDP touch events. Safari is not Chromium and iOS is not a viewport.
- **The iOS edge-swipe gesture and a horizontally scrolling board compete**, and that has not been
  observed. On iOS a swipe from the screen edge goes back in history; the board now also scrolls
  sideways. If it is a problem it will be at the left edge, at the first column.
- **A name longer than about eighteen characters will still truncate** at 150px. The measurement
  that chose 150 was `Alexandra Bergmann`, which fits.
- **A 30-minute box still clips its third line by two pixels, and always did.** Measured on the
  real board: 24 of 24 boxes clipped on a phone before this change and 2 of 24 after, and those two
  clip identically at 1280px. The height of a box comes from its duration and `--slot-height`,
  neither of which this change touches, so it is the same defect on every screen - three lines of
  text in 31px. Left alone deliberately: it is not this change's, and fixing it means deciding what
  a short box drops, which is its own ruling.
- The whole-day checkbox now sits in a heading row that scrolls sideways. It works; nobody has
  tried it with a thumb.
