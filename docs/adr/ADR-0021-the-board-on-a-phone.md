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

**That is not the whole truth, and the section below says what it leaves out** - it is a race with
the person holding the phone, and it does not blank a board already on screen.

Rejected with it: per-person accounts, which are the correct answer to the warning and are a table
of people, a redone session, screens to manage them and a migration; and keeping phones read-only,
which removes the reason for this change.

## Consequences

- A day sheet - named people and where they will be - now travels on personal devices. That is
  what ADR-0004 calls personal data under GDPR, and the salon is the controller of it. Nothing here
  changes what the API returns; what changes is where it is read.
- The desktop board scrolls inside its own box rather than scrolling the page. No visible change at
  1280px with six stylists: no horizontal scrolling, columns wider than the minimum, headings
  pinned as before.

  > That sentence originally said "verified", and it was verified only against short test names. A
  > review pass ran the same probe with `Alexandra Bergmann` and a treatment reading
  > `Waschen, Schneiden, Föhnen` and found the desktop board scrolling horizontally by 48px, plus
  > up to 41px of drift between the headings and the columns. The cause is below; the claim is
  > corrected rather than left standing.
- **Anything that assumed the page was the scrollport had to move with it**, and the first version
  of this ruling said of them "neither is wrong today", which was wrong on both counts. A review
  pass measured the loading line painting 58px *inside* a taller top bar on a phone - the label
  announcing a load printed across the date being loaded - and focus parking a half-hidden box
  behind the opaque heading band. The loading line is now positioned against the pane, and
  `scroll-padding-top` is on the pane rather than on `html`.
- **The headings and the board are two grids, and they must be given one width.** Sized
  independently, a `1fr` track resolves from each grid's own widest item, so they drift apart and
  every column from the second on is labelled with the previous stylist's name - a name stated
  confidently and wrongly, which is worse than the clipped name this change set out to fix. Both
  grids are 100% of one wrapper, which wraps only the grids: the undrawn-entries report would
  otherwise stretch it to the width of a sentence.
- **The frozen hour scale takes no presses.** Once the board is scrolled it covers whichever column
  has passed under it, and the grid resolves a stylist from the pointer's x - so a press on the
  times opened a form for somebody nobody could see. Refused in the handler rather than with
  `pointer-events: none`, which only lets the press fall through to the grid and reach the same
  wrong column.
- **`+ Termin` is absent while a day is loading.** The top bar is outside the `inert` subtree, which
  covers the board only, so during a step the header names one day and the board underneath is
  another. A review pass clicked the button in that window and booked onto the day just left, with
  the form showing no date at all to contradict the header.
- The login screen keeps its own layout. It carries the same `shell` class as the board, so the new
  flex column reached it at a higher specificity than `.login` and put the form flush against the
  left edge - measured at a centre of 188px on a 1280px screen. Every person in the salon meets
  that screen, and it is where this ruling sends them after a lost phone.

## What the security pass corrected about the response

Three things this ruling implied and does not deliver. The invalidation mechanism itself was
verified rather than taken on trust: `replacePassword` increments the credential version in the
same statement that writes the hash, and `requireSession` re-reads that version from the database
on every request, so the lost phone's cookie is dead on its next API call and there is no
server-side window.

- **The response is a race, and the phone is on the other side of it.** Reaching `Einstellungen`
  needs a live session and the PIN. A departed employee holding the phone has both - the session is
  on the device and the PIN is shared salon-wide by design. They can change the password *and* the
  PIN first, and the salon's only way back is then `MASTER_PASSWORD` from the server's environment,
  which on a VPS means somebody with shell access.
- **This change breaks a premise [ADR-0017](ADR-0017-a-changeable-salon-password-a-pin-and-a-master-key.md)
  relies on.** That ruling accepted unlimited PIN guessing on the stated grounds that it needs a
  valid session, "so it is a colleague", and measured the whole 10,000-PIN space at 65 seconds.
  This is what stops "holds a valid session" and "is a colleague" being the same sentence: the
  session now rides in a pocket. **The owner's answer: ten wrong tries per address per five
  minutes**, and they named it as a bump rather than a measure - "that is the login". So it is
  built, and ADR-0017 is amended rather than quietly contradicted.

  Two things decide whether such a limit helps or hurts, and both were settled by measurement:

  - **Only a wrong PIN costs anything.** The settings screen makes several requests every time it
    opens, all carrying the PIN it was given; counting those would lock out the person who typed it
    correctly.
  - **A missing header costs nothing either.** It is not a guess - it is what anything never given
    the PIN looks like. Counting it spent the budget on innocent traffic: the existing test that
    walks every settings route without the header burned eight of the ten tries in one go, and two
    unrelated tests started failing. An attack always sends a PIN.

  What it buys, stated plainly so nobody mistakes it for more: ten tries per five minutes still
  walks the whole four-digit space in about three and a half days. It also bounds - without
  closing - the thread-pool exhaustion ADR-0018 records, because the limit is checked before the
  scrypt comparison, so a blocked address costs no derive.

  **Untested here: that the limit is per address.** `trust proxy` is deliberately unset, so
  `X-Forwarded-For` cannot vary `request.ip` and the harness has one address to offer. When a proxy
  arrives it must be set to the specific hop, or the limit becomes one budget for the whole salon -
  which ADR-0017 already warns about for the login limiter.
- **A password change does not blank a phone that is already showing the day.** Polling stops while
  the tab is hidden - ADR-0019, deliberately - so a backgrounded board never learns the session
  ended and keeps the last-fetched day sheet painted indefinitely. Disclosure of what was already
  delivered, not a live session.

And said plainly, because this ruling should not have left it to be worked out: a session lasts
thirty days and is re-issued for a fresh thirty once it is a day old, and the board polls every
thirty seconds while visible - so **merely having the board open on the lost phone renews the
session for ever**. For that whole period the holder can read any date's customer names, treatments
and notes, can read out the customer list one letter at a time through `/api/suggestions`, and can
write. Nothing anywhere records that a session exists.

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
- **A booking cannot be dragged to a column that is off screen.** With ten stylists at 1280px the
  grid is wider than the pane and there is no auto-scroll during a captured drag, so the pointer
  can only reach the columns it can see. Traced by a review pass, not reproduced. This ruling
  offers the ten-person salon as a case the column minimum covers: it covers reading that board,
  not moving anything across it.
- **`+ Termin` opens on the salon's first hour, which is the slot most likely to be taken.** If the
  first stylist is already booked then, the phone's only way in opens pre-filled with a clash and
  is refused on `Speichern` with a sentence saying so. The board already owns `whyNotFree` and
  could pick a free hour; left alone as its own decision.
