# ADR-0015: Core hours shade the board and refuse nothing

- Status: accepted, with two paragraphs superseded on 2026-08-13.
  [ADR-0016](ADR-0016-hessen-holidays-are-a-list-in-the-code.md) took the no-public-holidays
  paragraph: Hessen's holidays are a hardcoded list and shade a whole day.
  [ADR-0018](ADR-0018-the-settings-screen-owns-staff-and-hours.md) takes the hours-as-a-constant
  paragraph: they moved into the database on 2026-08-14 so the settings screen can change them,
  and `CORE_HOURS` no longer exists. The rule that shading refuses nothing stands untouched, and
  it is the important half - the screen that edits the hours now says so in German, because that
  is where somebody would otherwise conclude the opposite.
- Date: 2026-08-13

## Context

The board draws 06:00 to 20:00 for every day of the week, and every hour of it looks the same.
The salon does not work most of that: Tuesday to Friday it is 09:00 to 18:00, Saturday 08:00 to
13:30, and Sunday and Monday are closed.

The owner asked for the ordinary working hours to stay white and everything else - including
all of Sunday and Monday - to be light red.

> The colour changed to grey on 2026-08-14, by the same owner looking at the built screen: red
> reads as a fault, and these are ordinary hours. Kept as written because it records what was
> asked for at the time. The ruling was never about which colour - only that there is one, that it
> is translucent, and that it refuses nothing.

The brief says the opposite about the concept, not about the colour: *"There is no concept of
opening days and this keeps it that way."* That line was written to stop opening hours becoming
a rule that refuses bookings. It is now half wrong and has been amended: the board knows the
hours, and nothing refuses anything.

## Decision

**Core hours are a display concept only.** `grid.ts` remains the single home of the bookable
window, which is still 06:00 to 20:00, every day, for everybody. An appointment at 07:00 on a
Sunday is accepted without a murmur, because the salon does book outside its hours and the paper
page always allowed it.

**Outside those hours the board is shaded.** A closed day is shaded from top to bottom. The
shading is translucent, so the quarter-hour and hour rules still read through it, and it starts at
the first employee column and spans them all, so the hour scale stays plain.

**It takes no clicks.** `pointer-events: none`, with a browser test that a closed hour still
opens the form. Shading that swallowed a click would have quietly become the rule this ADR says
it is not.

**The hours live in `src/calendar/opening.ts` as a constant**, keyed by ISO weekday, with a
missing day meaning closed. Not configuration: there is one salon, and a constant that has to be
edited and released is honest about that. It becomes configuration the day there is a second
salon, or the day the hours change often enough that somebody wants it without a release.

> Superseded by [ADR-0018](ADR-0018-the-settings-screen-owns-staff-and-hours.md) on 2026-08-13,
> before a line of it was written: that day arrived when the owner asked for a settings screen. The
> hours moved into the database on 2026-08-14 and `GET /api/day` sends them. The sentence above is
> kept because it named the condition under which it would stop being true, and then that condition
> happened - twelve hours later, which is the shortest life any ruling in this folder has had.

**There is no calendar of public holidays.** 25 December reads as an ordinary Friday. Inventing
one means a source of truth for holidays, a region, and a rule for the ones that move - and the
paper page did not have one either.

> Superseded the same day by ADR-0016. The owner answered all three: `feiertage-api.de`, Hessen,
> and a list rather than a rule. Kept as written because the reasoning was the reason to ask.

## Consequences

- Sunday and Monday now look different from a day the salon is merely quiet, which is the point:
  a photograph of the paper page could not tell you that either, and this is the thing the brief
  is trying to replace.
- The shading is a claim about the salon, so it is wrong the moment the hours change and nobody
  edits the constant. That is the cost of it not being configuration, and it is one line plus a
  release.

  > Closed on 2026-08-14 by ADR-0018. There is no constant and no release: the salon edits the
  > hours on the settings screen. What replaces this cost is a smaller one - the hours have no
  > history, so editing Saturday re-shades every Saturday that ever was.
- Nothing about the write path, the constraint, the colours or the drag rules moves. The board
  gained one more thing it draws and no rule at all.
- A weekday is derived from the date parsed as UTC midnight, the same way `dates.ts` does it, so
  no machine's timezone can move a band by a day: ADR-0007 again.

## Alternatives rejected

- **Refuse bookings outside core hours, or warn about them.** The obvious next step, and wrong
  here: the brief's non-goal is explicit that the full window is bookable for everyone, and a
  salon fits a regular in at 18:30 without asking anybody's permission.
- **Per-stylist hours.** Already a stated non-goal in the brief, and this ADR does not open it:
  the shading is one band across all columns, because it is about the salon, not the person.
- **A hard boundary drawn as a line rather than a wash.** Cheaper, and it reads as a limit -
  which is exactly the wrong impression for something that refuses nothing.
- **Configuration in the environment**, alongside the salon timezone. That is where this belongs
  the day it changes without a release; today it would be an environment variable with a default,
  which is a second place for the same fact to disagree with itself.
