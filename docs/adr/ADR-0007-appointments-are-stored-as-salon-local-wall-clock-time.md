# ADR-0007: Appointments are stored as salon-local wall clock time

- Status: accepted
- Date: 2026-08-12

## Context

An appointment is a person standing in one shop at a time written on a page. It is not
an event happening across timezones.

The textbook answer for storing times is an absolute instant in UTC, converted for
display in the viewer's timezone. That answer is a trap here, and a second client makes
the trap much easier to fall into. A stylist opening the app from another country would
see the salon's 10:00 rendered as 09:00 or 11:00, entirely convincingly, with nothing
on screen to suggest anything was wrong. A wrong time that looks right is worse than an
error.

This is also the least reversible decision in the schema. Changing it after real
appointments exist means rewriting every stored time while being certain which
interpretation each row was written under.

## Decision

An appointment is stored as a date plus a wall clock start and end time in the salon's
own timezone. Every client renders it in salon time, regardless of where the device is
or how it is configured.

The salon's timezone is recorded explicitly as configuration. It is never inferred from
the server, the container or the requesting device. Containers commonly run in UTC, so
inferring it would be quietly wrong on the very first deployment.

The API sends and receives salon-local dates and times, not instants, so a client
cannot accidentally reinterpret them.

## Consequences

- 10:00 means the salon's 10:00 to everybody. That is what the paper page means, and
  matching the paper is the point of the product.
- The board never has to ask what timezone the viewer is in, and the 06:00 to 20:00 grid
  needs no conversion to lay out.
- **Clocks-change weekends need checking, not assuming.** A wall clock time is ambiguous
  only inside an hour that a daylight-saving transition skips or repeats. In the
  European Union those transitions occur at 01:00 UTC, which falls at 02:00 or 03:00
  local time and therefore outside the 06:00 to 20:00 booking window, so no bookable
  time should ever be ambiguous. That is the reasoning this decision leans on and it is
  unverified for the salon's actual timezone. Confirm it before relying on it, and if it
  does not hold, this ADR needs a rule for the ambiguous hour.
- Any future feature that genuinely needs an absolute instant - a reminder sent at a
  moment in real time, for example - has to convert using the recorded salon timezone.
  That conversion is a deliberate step, in one place.
- Sorting and duration arithmetic stay simple, because everything is in one frame of
  reference.

## Alternatives rejected

- **Absolute instants in UTC, rendered in the device's timezone.** Correct for events
  that span timezones, wrong for a fixed physical location, and it fails in the most
  expensive way available: silently and plausibly.
- **UTC storage, but always rendered in salon time.** Equivalent on screen, and it
  reintroduces a conversion on every read plus a daylight-saving question on every
  write, in exchange for nothing this product needs.
- **Defer the decision.** Rejected. It is the hardest thing here to change once real
  data exists.
