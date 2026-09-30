# ADR-0010: Date arithmetic - ISO weeks and month steps

- Status: accepted
- Date: 2026-08-12

## Context

The header shows the day's date and its calendar week, and navigation steps by day, by
week and by month, with a date picker for anything further out. Every one of those is
date arithmetic that looks trivial and has a wrong answer that passes casual testing.

Two in particular, both settled here so nobody re-derives them from memory.

> **Amended 2026-09-30: month steps will not be built,** on the owner's call. The week-number
> half of this ADR stands. The month-step half below is kept as the record of what was settled,
> and governs nothing until somebody decides to build month steps after all. `addMonths`, which
> nothing on screen ever called, was deleted with its tests the same day.

## Decision

### The week number is ISO 8601, and its year is not the calendar year

Weeks run Monday to Sunday, and week 1 is the week containing 4 January, equivalently the
week containing the first Thursday of January. The week number displayed comes from the
ISO week-year, which is not always the year in the date.

Checked against the system date implementation rather than recalled:

| Date | ISO week-year and week | Calendar year |
| --- | --- | --- |
| 2026-08-13 | 2026-W33 | 2026 |
| 2026-01-01 | 2026-W01 | 2026 |
| 2026-12-28 | 2026-W53 | 2026 |
| 2027-01-01 | **2026-W53** | 2027 |
| 2027-01-03 | **2026-W53** | 2027 |
| 2027-01-04 | 2027-W01 | 2027 |
| 2021-01-01 | **2020-W53** | 2021 |

Two facts that follow, and they are not hypothetical:

- **2026 has a week 53.** Any code assuming weeks run 1 to 52 is wrong this year.
- **1 January 2027 is in week 53 of 2026.** The header must read `KW 53` on a date that
  says 2027, for six consecutive days from 28 December 2026. Deriving the week from the
  calendar year produces a confidently wrong number, and the salon reaches that date
  about four months after this decision.

The header shows the week number alone, as `KW 33`. The ISO week-year is not displayed
even when it differs from the date's year: it is correct without it, and a second year on
screen next to a different year is more confusing than the mismatch it explains.

### Week and month steps keep the weekday, month steps clamp the day

Stepping a week keeps the day of the week. Thursday to Thursday. That is the whole point
of the feature: a customer asking for the same slot in four weeks gets four clicks and the
same weekday.

Stepping a month keeps the day of the month, clamped to the last day of the target month
when that day does not exist:

- 31 January, forward one month, gives 28 February, or 29 February in a leap year
- 31 March, forward one month, gives 30 April

**Clamping is not reversible, and that is accepted rather than solved.** Forward from 31
January lands on 28 February; back from 28 February lands on 28 January, not 31 January.
A person clicking forward and then back does not always return to where they started. The
alternatives are worse: remembering the original day across clicks makes the button's
behaviour depend on invisible history, and refusing to step is absurd.

## Consequences

- Whatever computes the week number is tested against the boundary dates in the table
  above, not only against a comfortable mid-year date. 2026-12-28 to 2027-01-04 is the
  range that matters, and it is a fixed set of dates, so the test needs no clever
  generation.
- Leap years are part of the month-step tests, not an afterthought. Those tests were deleted
  with `addMonths` on 2026-09-30.
- The date in the URL, decided in the brief, is a plain calendar date. ISO week-years
  never appear in it, so no navigation state depends on this arithmetic being right -
  only the display and the step buttons do.
- A library may do all of this. If one is used it is still tested against the table above,
  because the failure mode being guarded against is confident wrongness, and a library is
  as capable of that as handwritten code, particularly on the week-year.

## Alternatives rejected

- **Derive the week number from the calendar year.** The obvious implementation, wrong
  for six days each time a year turns over on the wrong weekday. This is the entire
  reason this ADR exists.
- **Assume 52 weeks.** Wrong in 2026.
- **Show the ISO week-year alongside, as `KW 53 / 2026`.** Removes the apparent mismatch
  and puts two different years on screen at once. Rejected as more confusing than the
  thing it clarifies.
- **Weeks starting Sunday.** Wrong for the salon's locale and inconsistent with ISO
  numbering, which the week number itself is taken from.
