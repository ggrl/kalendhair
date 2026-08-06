# Coding standards - shape, not style

> **Audience:** any AI coding agent working in this repository.
> **Load this when:** you are about to add, move or restructure code.
> Formatting is handled by the linter. This file is about shape.

## A. One place for every business rule

**A rule of the business lives in exactly ONE place, and everything else asks it.**

Repeating a rule in a second file is a defect, not thoroughness. The two copies will
agree today and disagree in a month, and nobody will notice until somebody is looking
at the wrong answer on a screen.

On this repository's `example` branch, `src/report-triage/transitions.ts` is a worked
instance: it owns which verdict may follow which. The queue does not decide it. The
user interface does not decide it. Both ask. Because the table is typed over every
verdict, adding a verdict without adding it to the table is a compile error - the
rule is enforced by the language, not by a comment asking nicely.

Repeating how something LOOKS is fine. Two screens can render a list similarly
without that being duplication. Repeating what something MEANS is the bug.

## B. Deep modules: a small door, a large room

A module should be **easy to use and free to be complicated inside**. The measure is
the ratio: how much does a caller have to learn, against how much they get.

A good module hides a decision. On the `example` branch, `src/report-triage/` hides
where reports are stored, what makes one valid, and which transitions are legal.
Callers know four functions. Storage could move to a server tomorrow and nothing
outside that folder would change.

A shallow module costs nearly as much to learn as it delivers - a wrapper that
forwards one call, a helper that saves three characters, a layer that exists because
somebody felt there should be a layer.

**Do not create an abstraction to reduce line count.** Duplication is cheaper than
the wrong abstraction, because the wrong abstraction has to be unpicked before the
real one can exist. Wait for the second real caller.

## C. Explicit contracts at the edges

Say what things are. Use a narrow set of allowed values rather than an open string:
`'New' | 'Investigating' | 'Phishing'` prevents a whole category of mistake that
`string` invites.

Validate at the boundary - the moment data arrives from a person, a file, a network
or storage. Inside the module, past that boundary, the data is known good and you can
stop re-checking it.

Avoid `any`. It is not a type; it is switching the checking off. The one deliberate
cast in this repository is commented at the line explaining why it is safe. That is
the standard: if you must reach past the type system, say why, where you did it.

## D. Fail fast, and loudly

Reject bad state where you find it. Do not paper over a broken assumption with an
empty error handler, a silent default, or a guessed value.

**A silent fallback is worse than a crash**, because a crash gets fixed on Tuesday
and a silent fallback gets discovered in six months by somebody looking at wrong data
and believing it.

If something genuinely may fail and the program should continue, make that path
explicit and say so out loud in the code.

## E. Flat control flow

Guard clauses and early returns. If a function needs more than two levels of nesting,
flatten it or explain why in the review.

Optimise for the reader who has to understand this one function without opening five
others. That reader is usually you, in three weeks, with no memory of today.

## F. Names state intent

`nextVerdicts` says what you get. `getData` says nothing. `assertTransition` tells you
it will throw. A name that describes the implementation instead of the purpose has to
be rewritten every time the implementation changes.

## G. Comments explain decisions, not code

A comment restating the line below is noise that goes stale.

A comment explaining a decision that is not visible - why this order, why not the
obvious approach, what breaks if you change it - is the most valuable thing in the
file. Every comment in the `example` branch's `src/report-triage/` is of that kind.
Match that.

## H. Look at the whole flow before changing part of it

Before changing anything that touches stored data, permissions, or a rule with more
than one consumer, find every place that reads it: how it is stored, what writes it,
what displays it, what reports on it, what checks permission on it.

**Inspecting widely and then fixing narrowly is the goal.** This is a rule about
READING broadly, never about writing more. `less-is-more.md` still gates every line
you add.

## Related

`less-is-more.md` runs first, always. `what-checks-prove.md` for the evidence that
the shape actually works.
