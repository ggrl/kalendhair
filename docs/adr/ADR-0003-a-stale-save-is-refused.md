# ADR-0003: A save against a stale version is refused

- Status: accepted
- Date: 2026-08-12

## Context

The whole reason this replaces a photograph is that several people have the same day
open at once. So two of them editing the same appointment is not an edge case. It is
the normal consequence of the feature working.

The default behaviour of a naive implementation is last-write-wins: whoever saves
second overwrites the first, silently. Nothing warns anybody, nothing is recorded, and
an appointment can change or vanish with no trace of why. That is a class of bug that
cannot be reproduced afterwards, because the evidence is what got overwritten.

## Decision

Every appointment carries a version stamp. A save must send the version it was read
at. If the stored version has moved on, the save is refused and the person is told the
appointment changed underneath them, so they can reload and redo it.

This stays in place alongside the live board. Polling narrows the window; it does not
close it. Two saves inside one polling interval still collide, and this is what catches
them.

## Consequences

- Nothing is ever silently lost. A refusal is visible and the data is intact.
- Whoever loses the race retypes their change. Accepted in the interview as the cost of
  never losing one.
- Every write path has to carry and check the version: create, modal edit, drag to
  move, edge-drag to resize.
- A refusal can land mid-drag. The board has to recover from that without leaving a box
  in a position the server never accepted.

## Alternatives rejected

- **Last save wins, silently.** Cheapest by a wide margin, and it loses customer
  bookings in a way nobody can later explain.
- **Live updates so the collision cannot happen.** It does not go that far. Live
  updates reduce how often two people hold the same stale read; they cannot make the
  window zero. This ADR is the backstop underneath that feature, not an alternative to
  it.
