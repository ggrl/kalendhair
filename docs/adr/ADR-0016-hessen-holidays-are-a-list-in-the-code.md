# ADR-0016: Hessen's holidays are a list in the code, and the list expires loudly

- Status: accepted
- Date: 2026-08-13
- Supersedes: the "there is no calendar of public holidays" paragraph of
  [ADR-0015](ADR-0015-core-hours-shade-the-board-and-refuse-nothing.md), written the same day

## Context

ADR-0015 shaded the hours the salon does not normally work and explicitly declined to know
about public holidays: 25 December read as an ordinary Friday. The reason given was that a
holiday calendar needs a source of truth, a region and a rule for the ones that move.

The owner asked for Hessen's holidays to be shaded like a Sunday, and answered all three of
those: the source is `feiertage-api.de`, the region is `HE`, and the moving ones come from the
list rather than from a rule this code has to implement. They also proposed hardcoding five
years rather than calling the API, which is the right instinct and is the decision here.

## Decision

**A list in `src/calendar/opening.ts`, not a request.** Fifty dates, 2026 to 2030, each with its
name in a comment so a human can check it. A holiday makes `coreHoursOn` return null, which the
board already draws as a full-day wash - the same thing it does for a Sunday, because to somebody
looking at the board it means the same thing.

**No request at runtime, ever.** The board's colours must not depend on somebody else's server
being reachable. A self-hosted salon board that cannot say which day is a holiday because an API
is down is worse off than one that is occasionally out of date, and the failure would arrive
exactly when the network does not.

**The dates were checked before they were written down.** Christi Himmelfahrt is Easter plus 39
days, Pfingstmontag plus 50, Fronleichnam plus 60, and all five years agree with the endpoint.
Hessen keeps Fronleichnam and does not keep Reformationstag or Allerheiligen, and a test asserts
the absent ones - a list copied from the wrong state would close the salon on a working day,
which is the more expensive mistake.

**The list expires loudly.** `HOLIDAYS_COVERED_THROUGH` names the last date it can speak for,
and a unit test fails when that is less than a year away, naming the URL and what to do. This is
the one test in the project that reads the clock, deliberately: a hardcoded list going stale is
invisible - the board simply stops marking holidays and looks exactly as correct as it did the
day before.

**Only public holidays.** Heiligabend and Silvester are working days in Hessen and are not in
the list, whatever the salon chooses to do about them. If they want those shaded, that is a
different fact - the salon's own closures - and it belongs with the salon's hours, not with the
state's holidays.

## Consequences

- Refreshing the list is a five-request job every few years: one per year from
  `https://feiertage-api.de/api/?jahr=YYYY&nur_land=HE`, checked against the Easter arithmetic,
  then move `HOLIDAYS_COVERED_THROUGH`. The test says so in its failure message rather than
  leaving it to be rediscovered here.
- Still shading, still refusing nothing. ADR-0015's rule holds: 06:00 to 20:00 is bookable on
  Christmas Day, because the constraint is the only thing that refuses anything and it does not
  know what day it is.
- A holiday in another state shows as an ordinary working day, correctly. This is a Hessen salon,
  and the ADR says so rather than leaving `HE` looking like a default somebody picked.
- The board says nothing about *which* holiday it is. The names are in the source as comments,
  not on screen. If the salon wants `Karfreitag` in the header, that is a small change and it
  needs a decision about the top bar, not about this list.

## Alternatives rejected

- **Call the API at runtime, cached.** Always current, and it puts a third party between the
  salon and the colour of their board. It also needs a cache, a failure mode, and a decision
  about what to show while it is unreachable - three things the list does not need.
- **Compute the holidays.** Gauss's Easter algorithm plus the fixed dates is perhaps thirty
  lines, and it would cover every year forever. Rejected because the arithmetic is easy to get
  subtly wrong, nobody here would notice a wrong Fronleichnam, and the wrongness would be
  permanent rather than expiring with a message. The arithmetic was used to *check* the list,
  which is the right side of that trade.
- **A list with no expiry test.** Cheaper by one test, and it fails silently in 2031 by simply
  drawing nothing. That is the exact failure this project keeps finding: a screen that is wrong
  and looks right.
- **Fetch at build time.** Tempting, and it makes every build depend on a third party being up,
  including a build during an incident.
