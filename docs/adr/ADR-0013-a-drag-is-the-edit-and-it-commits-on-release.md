# ADR-0013: A drag is the edit, and it commits on release

- Status: accepted
- Date: 2026-08-13

## Context

The brief asks for drag to create, drag to move across time and columns, and edge-drag to
resize, because that is what the paper page does when somebody redraws a line. It does not
say what a release means. Two readings lead to different code and neither is obviously
wrong:

- the gesture proposes, and a form confirms it - safe, and a dialogue on every move is the
  friction the paper page does not have;
- the gesture IS the edit - which is the thing worth having, and there is no undo anywhere
  in this application.

The owner chose the second, in an interview, with the cost stated. Everything below follows
from that choice, and it is written down because a later session looking at an accidental
move will be tempted to add a confirmation and quietly undo the decision.

## Decision

**A move or a resize saves the moment the pointer is released.** No dialogue, no
confirmation. The refusals ADR-0001 and ADR-0003 already provide are what stands behind it.

**Dragging out a range on empty grid writes nothing.** It opens the form with the range
filled in, because an appointment needs a customer before it can exist.

Because the release is the write and there is no undo, both guards sit in front of it:

**A gesture must travel half a row, in pixels, before it counts as a drag at all.** Slots are
not a threshold: a row is 17.6px, so comparing slots meant a three-pixel twitch across a row
line saved a fifteen-minute change from about a third of every box. Once past the threshold
the slot arithmetic decides *what* to write; it never decides *whether* to write.

**A drop the browser can already see is occupied is refused before it is sent**, with the
same sentence the server would have used, and the box springs back. `TIME_TAKEN` has one
home for that reason. This is a convenience, not enforcement: the exclusion constraint
decides every write, per ADR-0001.

**A gesture is abandoned if the board moves to another day while the pointer is down.** The
day is captured at `pointerdown`. A release cannot write to a day nobody was looking at,
because the drop's coordinates were computed against a board that is gone, columns included.

**Both edges resize, and blocks drag and resize exactly like appointments**, per ADR-0008:
one table, one constraint, one set of gestures.

## Consequences

- **An accidental drag is a real change with no undo.** The threshold and the early refusal
  reduce it; they do not remove it. If this ever costs somebody a real appointment, the
  answer is an undo, and that is a new ruling with a server side to it - not a confirmation
  dialogue bolted onto the release.
- **Resizing a whole-day block shortens it,** and the column's checkbox then reads unticked.
  That is correct - it is one ordinary 06:00-20:00 row - and it will look like a bug the
  first time somebody does it.
- **There is no keyboard equivalent for any gesture.** The form is the path without a mouse,
  which is consistent with mobile and touch being product non-goals, and it means the board
  is not fully operable from a keyboard. Anybody who needs that has the form.
- **No autoscroll while dragging**, so a gesture only exists between two points that are both
  on screen. On a laptop that means scrolling to the part of the day being worked on first.
- **No cancel key.** Escape does not abandon a drag in progress; putting the pointer back
  where it started does, and a cancelled pointer says nothing was moved.
- Every gesture is computed in slots rather than pixels, so the board can only ever propose a
  time it can also draw. The arithmetic lives in `src/ui/gesture.ts` with unit tests, because
  the browser suite is not part of `npm run verify`.

## Alternatives rejected

- **Open the form pre-filled and save on Speichern.** Reuses the write path exactly, and
  nothing is written without a deliberate click. Rejected by the owner: a dialogue on every
  move is what made the products they tried unusable.
- **Save at once with an undo for the last move.** The safest answer and the most machinery:
  a client-side undo stack, plus the question of what undo means once somebody else has
  changed the same box. The server has no undo - it would be a second write, which can itself
  be refused.
- **Any pointer movement is a drag.** Simpler to explain and it removes the forgiving click,
  which a trackpad cannot deliver: a press without movement is rare, so the board would have
  no reliable way into the form.
- **Send every drop and let the server decide.** One rule in exactly one place, which is the
  strictest reading of the coding standard. Rejected because the box visibly lands and then
  jumps back when the refusal arrives, and on a slow connection that reads as a fault.
