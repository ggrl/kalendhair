# Less is more - the first gate on every line of code

> **Audience:** any AI coding agent working in this repository.
> **Status:** hard rule. This gate runs BEFORE every other rule. It outranks
> thoroughness, defensive depth, and your own sense of completeness.

## The rule

**You may not write a single unnecessary character.** Not one extra column, table,
file, abstraction, flag, constant or branch. Only what a real, currently-shipping
behaviour of this application actually needs in order to work correctly and safely.

## The gate: answer before writing, not after

For every unit you are about to add, answer all three. If any answer fails, do not
write it.

1. **Which real behaviour of the running app breaks without this?** Name the screen
   and the user. "A reviewer cannot see the reports assigned to them" passes. "An
   administrator might one day want to bulk-reassign reports" fails.
2. **Is the scenario observed or invented?** Observed means someone reported it, a
   log line shows it, a row in the database proves it, or a test fails. Invented
   means you thought of it while reading the code. **You may not build defences for
   invented scenarios.** Report them instead.
3. **Does a mechanism for this already exist?** Reuse beats extend, extend beats add.
   A new file, module or table is the LAST resort and must be justified against the
   existing thing you rejected.

## Spotting risk is still required. Building for it is not.

This rule does not make you incurious. Keep hunting for real threats, inconsistencies
and illogic - that is the job. What changes is what you do with a finding you have
not verified:

- Verified against real code or real data: fix it, minimally.
- Suspected, unverified, or hypothetical: **write it in your report, do not build for
  it.** One sentence to a human costs nothing. A speculative column costs a
  migration, a backfill, a decision record, and rounds of review.

## Banned by name: defences against collisions nobody has seen

Locks, leases, timeouts, "stale versus fresh", claim ownership, release sweeps,
compare-and-set on who-got-there-first: **do not build these unless the collision has
been reported happening.** Most projects have one person doing a given job. Two people
racing for the same row is usually not a real scenario, and if it is, someone will
say so.

The correct shape for "who wins" is a single condition asserting the state you read,
and an honest message when it matches nothing. That is one line. Anything larger is
the banned thing.

If you catch yourself writing a condition about elapsed time, about who holds
something, or about what happens when two people overlap: stop. Ask whether the
overlap has ever been observed. If not, delete the condition.

## Speed is part of correctness

A reported bug means people are waiting. Ship the smallest fix that ends the waiting,
then improve. A day spent perfecting an unshipped change is worse than an hour spent
shipping the two-line fix.

## A reviewer's finding is not an order

An external reviewer - another model, a security scanner, a linter - reads the code
without the business. It does not know how many people use this, what they are
trusted to do, or what is reversible. So it reports every theoretically reachable
sequence as a blocker, and it is right to. That is its job.

**Its findings go through this gate like everything else.** Before building a defence
a reviewer asked for, answer the same three questions, plus one more:

**What does the bad outcome actually cost, and is it reversible?** If the worst case
is "someone opens the screen again and clicks", that is not worth a refusal path, new
copy, and the risk of blocking honest work. Irreversible loss - deleted work, a
leaked secret, a record gone - is a different matter and does earn the code.

When you decline a reviewer's finding, say so in your report with the reason. A
declined finding is a decision, not an oversight.

## Where this came from

A team asked for three specific behaviours and added, in writing: "do not
overcomplicate this, the system is complicated enough already."

What arrived instead was a new state model, a database trigger, four new columns, a
migration with a backfill, a recovery runbook, two decision records and a serialized
writer. **69 files, over eight thousand lines.** The trigger for all of it was a
scenario nobody had reported.

Then the external reviewer returned a blocking verdict with six findings. **Five of
the six were defects in the invented machinery, not in the work that had been asked
for.** Seven review rounds went into reviewing an invention, while the three requested
behaviours had passed review in round one.

The lesson is not "review harder". It is: **the code that cannot contain a bug is the
code you did not write.**

## Related

- `facts-only.md` - the second gate: claim only what you have verified.
- `coding-standards.md` - one source of business knowledge, and why an abstraction
  that only reduces line count is not worth having.
