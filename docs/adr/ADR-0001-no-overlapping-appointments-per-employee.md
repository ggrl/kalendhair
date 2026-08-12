# ADR-0001: An employee's appointments may never overlap

- Status: accepted
- Date: 2026-08-12

## Context

Google Calendar allows overlapping events and renders them side by side, splitting the
column. That is the behaviour most people expect from a calendar, and copying it here
is the obvious move.

It is wrong for this product. Google books rooms and people who genuinely can be
double-booked. A salon chair cannot. One stylist with two customers at 10:00 is not a
layout problem to be rendered prettily - it is a mistake somebody will discover when a
customer is standing in the shop.

## Decision

An appointment may not overlap another appointment for the same employee. The save is
refused and the reason is shown.

Enforcement is server-side. A check in the browser is a convenience, not a rule: it can
be bypassed, and it cannot see a save arriving from another machine.

A read-then-write check is not sufficient either. Two saves arriving at once can both
read a clear slot and both write. The intent is a database constraint, so the database
settles the race. The exact mechanism is to be confirmed against Postgres
documentation before it is written.

## Consequences

- The calendar catches a real-world error instead of displaying it. That is the point.
- A stylist who genuinely runs two customers at once - colour processing on one while
  cutting another - cannot record it. This was raised in the interview and accepted.
  If it turns out to be common, this ADR is what to supersede.
- Every write path pays the constraint: create, drag to move, and edge-drag to resize
  all have to handle a refusal, including mid-drag.

## Alternatives rejected

- **Allow and render side by side**, as Google does. Flexible, and the tool would then
  never tell you that you had made a mistake.
- **Allow but warn.** Keeps the flexibility and makes the clash visible. Rejected
  because a warning seen every day stops being read.
