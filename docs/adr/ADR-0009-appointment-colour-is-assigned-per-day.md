# ADR-0009: Appointment colour is assigned per day, one colour per customer

- Status: accepted
- Date: 2026-08-12

## Context

The request was that boxes get random colours, with the same name on the same day
getting the same colour. The reason behind it is specific and it changes the design:
when a customer's hair is dyed, another customer is fitted into the gap while the dye
sets. The first customer therefore has two appointments that day with somebody else's in
between, and colour is what shows those two boxes are one person.

So colour is not decoration. It is a claim: same colour means same customer.

That rules out the obvious implementation. Hashing a name to a palette slot means two
unrelated customers land on the same colour by accident, and with more names in a day
than there are distinguishable colours, repeats are not an edge case but arithmetic. Each
accidental repeat makes exactly the statement colour is supposed to make, and nothing on
screen distinguishes a real pair from a coincidence.

## Decision

Colour is assigned per day, not derived from the name in isolation.

For a given day, the distinct customer names on it are collected and each is given a
different colour from the palette. Every appointment box is coloured. Two boxes share a
colour only if they are the same customer, for as long as the palette lasts.

Details that follow:

- **Names are matched after trimming whitespace and ignoring case**, so "anna schmidt"
  and "Anna Schmidt" are one customer rather than two colours. Without this the link
  fails silently, which is worse than not having it.
- **Customers with more than one appointment that day are assigned colours first.** When
  the palette runs out, the repeats then land on single appointments rather than on the
  pairs the feature exists to show. This is an ordering rule, not a second mechanism.
- **The server computes the colour and sends it with each appointment.** It has to,
  because the colour depends on the whole day rather than on the row, and this way a
  future iOS app does not re-implement the algorithm and drift out of agreement with the
  web board. See ADR-0006.
- **Nothing is stored.** Colour is derived on read, so there is no column, no migration,
  and no way for two boxes with one name to disagree.
- **Grey is not in the palette.** It means a block. See ADR-0008.

## Consequences

- A pair is visible at a glance, which is what the feature is for.
- Adding a second appointment for a customer can change the colours of other boxes on
  that day, because assignment depends on the whole set. Correct, and worth knowing
  before somebody reports it as a bug.
- **The meaning degrades once the palette runs out, and this was chosen knowingly.** The
  palette is **ten** colours - the number was unknown when this was decided and is now
  fixed in `src/calendar/colours.ts`. Six stylists over a fourteen-hour day will pass ten
  distinct customers on most days, not only busy ones, so two strangers sharing a colour
  is the ordinary case rather than the exception. Confirmed as acceptable by the owner
  after the number was known: overlapping colours are not a problem worth more machinery.
- **The ordering rule guarantees the repeat never lands on a customer who has two boxes.**
  This is the part that carries the claim, so it is enforced rather than hoped for: when
  the palette is exhausted, overflow reuses only the slots given to single appointments.
  The first implementation did not do this. A plain `index % PALETTE.length` wrapped
  customer eleven onto slot zero, which is the colour of the customer with the most
  appointments - so the one arrangement the rule exists to protect was the first thing it
  broke, and a test asserted that behaviour while its comment claimed the opposite. Found
  by review, fixed, and now covered by a test that asserts the property instead of the
  arithmetic.
- **Colour alone is not accessible.** A customer who cannot distinguish two palette
  colours cannot see the link, and a grey block is only distinguishable from a coloured
  appointment if the palette keeps clear of grey. The palette needs choosing for
  distinguishability rather than prettiness, and the pairing should not be the only way
  to learn two appointments belong together - the customer's name is written on both
  boxes and remains the authoritative signal.
- Text on a coloured box has to stay readable, including on a 15-minute box, which
  constrains how dark or saturated the palette can be.

## Alternatives rejected

- **Only customers with two or more appointments that day get a colour, everyone else
  stays neutral.** Colour would then always mean something and never lie, the palette
  would never run out because pairs are rare, and the pair would stand out more on a
  calmer board. Rejected in favour of a fully coloured board, with the degradation above
  accepted. This remains the natural successor.
- **Hash the name to a palette slot.** Simplest, needs no knowledge of the rest of the
  day, and regularly colours two strangers identically. Rejected once the purpose of the
  colour was known.
- **Colour follows the name across all days.** A regular would be recognisable
  day to day. Rejected: the link being shown is a within-day one, and stability across
  days adds nothing to it.
