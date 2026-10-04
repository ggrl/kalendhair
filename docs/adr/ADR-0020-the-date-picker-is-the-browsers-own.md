# ADR-0020: The date picker is the browser's own

- Status: accepted and built, 2026-08-14; amended 2026-10-04 and 2026-10-05 for the iPhone
- Settles the date picker named in `docs/PRODUCT_BRIEF.md`'s build order. Supersedes nothing;
  ADR-0010 still owns every piece of date arithmetic and is not touched

## Context

Navigation is day steps, week steps and `Heute`. Reaching October from August is about eight
week-clicks or sixty day-clicks, and the brief has listed a date picker in its build order since
the first interview without one being built.

The owner asked for "a small calendar where you can see the months and travel through them and
pick a date". That is a description of a control, and the first question was whether it needed
building at all.

## Decision

**`<input type="date">`, and nothing of our own.**

Chrome opens exactly the control that was described: a month grid with arrows to page through
months. It arrives with the German locale, full keyboard support and a name a screen reader can
read, none of which we would get for free from a component of ours.

**A phone opens the native date wheel**, which is the deciding argument rather than a bonus. The
board is about to go on phones (ADR-0021), and nothing we could build would beat the picker the
device already has.

**The picker's value is the day on screen, not today.** It opens where the person is looking, and
it follows the board when the board moves by any other means - a week step, `Heute`, the browser's
Back button.

**One place decides whether a date is real, and it is not the picker.** Every change is handed to
`App.tsx`, which refuses anything `isSalonDate` rejects and goes nowhere. That covers a cleared
field, a half-typed date and a two-digit year alike, because all three are the same answer: not a
date this calendar can represent.

> Written this way after a mutation test. There was a second guard in `TopBar.tsx` refusing the
> empty string, and deleting it changed no test result - `isSalonDate('')` is already false, so the
> guard was a copy of a rule it was not the authority for. The copy that is never the authority is
> the one that drifts.

**An impossible date moves nothing, silently.** That is the behaviour a step off the end of the
calendar already has, and the reason is recorded in `dates.ts`: `Date.UTC(50, 0, 1)` means 1950,
so a two-digit year fails silently rather than loudly, and `isoWeek('0050-03-15')` returned
`KW -99126`.

## Consequences

- The picker looks like the browser rather than like this board, and differs a little between
  Chrome, Firefox and Safari. Accepted: it is navigation, not part of the paper page being
  reproduced.
- **Its date format is the machine's, not ours, and ADR-0011 does not reach it.** Measured in
  headless Chromium: `14/10/2026` in both a `de-DE` and an `en-US` context, and the document's
  `lang="de"` changes nothing. The order is day-first, which is German order, so the reading is
  right and only the separator is wrong - and it sits directly under a heading that says
  `Mittwoch, 14. Oktober 2026` in full. **Nobody has seen it on a salon machine**, and there is no
  way to override it from the page: this is the price of not building the control. If it ever reads
  wrongly to the salon, that is the argument for the popup this ADR rejected, and it should be
  recorded as such rather than patched.
- **"A phone opens the native date wheel" was never true on an iPhone; found 2026-10-04.** The owner
  tapped the glyph on iOS 26.6.2, in Safari and in Firefox, and nothing opened. iOS has
  `showPicker` and it does nothing for a date field: MDN's compatibility data marks it unsupported
  there, citing WebKit bug 261703, still open, where a WebKit engineer writes that iOS pickers are
  "tied to element focus". Firefox on iOS fails the same way because it runs on WebKit too.
  **So every click on the glyph focuses the field before calling `showPicker`.** A first fix
  focused only when the click's `pointerType` was "touch", and changed nothing: the owner's Web
  Inspector showed iOS 26 reporting a finger's click as "mouse". Focusing from the click handler
  was then seen to open the wheel on the same phone, 2026-10-05.
  Focus left in the hidden field would make arrows edit the date instead of stepping the board, so
  the first key the field receives moves focus to the glyph and still acts on the board. A key
  reaches the field only once its popup is closed. Not a plain `blur()`: a review pass measured the
  next Tab walking back into the field. The cost: that first key is used up if it is Tab, F5,
  Enter, Space or Shift alone - Tab then lands on the glyph rather than the next control.
- ADR-0010's arithmetic is untouched. This adds a way to choose a date, not a way to compute one.
- The label is present for a screen reader and invisible on screen, because the top bar has no room
  for a word and the control says what it is by its shape.
- Month steps and arrow keys remain unbuilt and remain on the brief's list. This does not replace
  them: they keep the weekday, which is what makes "same slot in four weeks" four clicks.
  *Amended 2026-09-30: the arrow keys were built on 2026-08-14, and month steps were dropped and
  will not be built. See ADR-0010.*

## Alternatives rejected

- **A calendar popup of our own.** Identical in every browser, styled like the board, and able to
  mark which days already have appointments later. It is also focus trapping, keyboard navigation,
  click-outside, month arithmetic and its own tests - several hundred lines - and on a phone it
  would compete with a native picker that is better than it. If marking booked days is ever wanted,
  that is the moment to revisit this, and it needs an API that does not exist.
- **A text field taking `TT.MM.JJJJ`.** No popup at all and no browser differences. It puts the
  parsing of German date formats into this codebase, which is exactly the class of thing
  `isSalonDate` exists to keep out.
- **Refusing an out-of-range date with a message.** More honest than a silent no-op, and
  inconsistent with the day and week steps, which already go nowhere quietly at the edge of the
  calendar. One behaviour for "that is not a day this board can show" is better than two.
