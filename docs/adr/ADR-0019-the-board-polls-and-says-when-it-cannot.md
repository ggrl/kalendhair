# ADR-0019: The board polls, and says so when it cannot

- Status: accepted and built, 2026-08-14
- Supersedes nothing. Settles the polling paragraph of `docs/PRODUCT_BRIEF.md`, which was a
  mechanism hypothesis and had never been ruled on, and removes the `Aktualisieren` stopgap that
  existed only because nothing polled

## Context

The board has shown a day loaded once since the first session. It looks exactly as trustworthy nine
hours later, which is **the failure this product exists to remove**: the brief's whole observation
is that a photograph is a dead copy the moment it is sent and nobody holding one can tell how stale
it is. A screen with the same property is that failure with better typography.

`Stand HH:MM` and an `Aktualisieren` button were built as a stopgap and labelled as one. The work
log has carried "nothing polls" as its oldest open item for five sessions.

The brief already chose polling over server push, and gave the reason: the original argument was
that a serverless function may not hold a connection open, which stopped being true when this became
a long-running Node server, so the choice now rests on simplicity alone. A salon board is not a
trading floor, and polling survives proxies, sleeping laptops and dropped wifi with no reconnection
logic to get wrong. That is not re-decided here; what was never decided is everything below.

## Decision

**Every thirty seconds, the board asks again for the day it is already showing.** Not for today -
for whatever is on screen. The unit of change on this board is a fifteen-minute slot; faster buys
nothing anybody can act on and multiplies by every machine in the salon.

**A poll is not a load.** It does not dim the board, does not show the loading line, and does not
set `inert`. Those exist for a navigation somebody asked for and they are correct there. Doing any
of them every thirty seconds would make the screen flicker on its own and take the keyboard out of
somebody's hands mid-sentence.

**Nothing swaps under a hand.** While a drag is in flight or the form is open, a day that arrives is
held and applied the moment the gesture ends or the dialogue closes - not dropped, so the board is
at most one gesture behind rather than one whole interval. The brief names this case: an update
must not yank the box out from under the cursor. ADR-0003 is still the backstop underneath it, so
holding the screen still cannot lose anybody's write.

**The day on screen never changes.** Polling asks for the date already being shown, so it cannot
navigate; and a held day whose date no longer matches is discarded rather than applied. A board left
on today overnight still reads that date in the morning - what disappears is the `· heute` mark,
which stops being true at midnight.

**It stops when the tab is hidden, and asks once immediately on return.** A board left open all
night makes no requests instead of about 2,800, and a tab nobody is looking at is by definition
showing nobody anything. Somebody switching back is about to read the board, which is the moment it
is most likely to be wrong.

**Two failures in a row, and the board stops claiming to be current**: `· nicht aktuell` beside
`Stand HH:MM`. The boxes stay - a five-minute-old board beats an empty one - and what goes is the
claim. One failure says nothing, because a single dropped request is the commonest failure on salon
wifi and a board that cried stale on every blip would train everybody to ignore the one line that
matters when the network is actually gone.

**`Aktualisieren` is removed.** The timer never stops trying, so a stale board recovers on its own
within thirty seconds of the network doing the same. There is nothing to press and nothing that
needs pressing.

**"Not current" is one idea with two causes.** A navigation that failed and a poll that failed twice
both mean what is on screen cannot be trusted, and they now share one phrase. Two near-identical
German sentences for the same fact would say less than one.

## Consequences

- The `Stand HH:MM` line stops being a stopgap and becomes the thing that makes polling honest. It
  is now load-bearing: without it, a board whose polling has silently stopped is exactly the
  photograph problem again, and this time it looks alive.
- `Board.tsx` gained one outward-facing fact - whether a gesture is in flight - because the poll has
  to know and the gesture lives nowhere else. It is a notification and not a control: nothing in the
  board changes because of what the listener does with it.
- A chained `setTimeout` rather than `setInterval`, so the next ask is scheduled when the last one
  finishes. An interval fires regardless of whether the previous request came back, and on a slow
  connection that stacks requests until one wins a race and the board flickers between two answers.
- A poll answered with 401 stops the polling and shows the login screen, rather than retrying an
  ended session every thirty seconds.
- Two of the brief's awkward cases are now closed by code rather than by a warning: an update
  arriving mid-drag, and an appointment deleted elsewhere while its form is open - the second
  because the form is not disturbed and the save still meets the server's existing `gone` refusal.

## Known, accepted, and not fixed here

- **The write path still does not check `active`.** A client holding an old day can send an edit for
  an entry the board no longer shows, and `updateEntry` accepts it by id. Two review passes have
  flagged it and ADR-0018 places it with the write path. Polling **narrows** the window rather than
  opening it - today a stale day is held until somebody reloads, and after this it is held for at
  most thirty seconds, or as long as somebody keeps the form open. Named here so it is not mistaken
  for something this change fixed.
- **Thirty seconds is a judgement, not a measurement.** Nobody has run six machines against one
  server in a real salon. The number is one constant in `App.tsx`.
- **A held day is dropped when its date stops matching**, which means navigating with the form open
  costs one interval rather than being applied instantly. Correct and cheap; worth knowing.

## Alternatives rejected

- **Server push over a WebSocket or SSE.** Genuinely live, and the brief already argued this one:
  reconnection logic, proxies and sleeping laptops are all cost, for a board where thirty seconds
  is indistinguishable from instant. Available whenever polling proves not to be enough.
- **Patching individual boxes from the response instead of replacing the day.** Less to redraw, and
  it breaks ADR-0009: colour is assigned from the whole day, so one new appointment can change the
  colour of boxes it never touched, and a client stitching its own copy would quietly disagree with
  every other screen.
- **Rolling the board over to the new day at midnight.** What somebody walking up in the morning
  almost certainly wants, and it changes the day on screen with nobody touching it - which the brief
  forbids outright, and it would do it to a stylist who had deliberately navigated to Friday.
- **Keeping `Aktualisieren` as a way to skip the wait.** My recommendation, on the grounds that it
  is the escape hatch when the board says it is stale. The owner removed it: the timer is already
  trying, so the button only ever saves thirty seconds and costs a permanent control in a top bar
  carrying four.
- **Going stale on the first failed poll.** Maximum honesty and the simplest rule to state. Rejected
  because a single lost packet would put a warning on a board that is in fact perfectly current,
  several times a day, and a warning that is usually wrong is a warning nobody reads.
- **Polling every five to ten seconds.** Closer to live, and about 4,300 requests an hour from six
  machines against one small server for a board whose unit of change is fifteen minutes.
