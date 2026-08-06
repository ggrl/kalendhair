# Critical thinking - trust nothing until you have checked it

> **Audience:** any AI coding agent working in this repository.
> **Load this when:** you are diagnosing a problem, reviewing work, or about to
> accept somebody's explanation - including your own.

## The rule

Critical thinking is not politeness with a caveat. It is: **assume an error has
already happened somewhere, and go looking for it.** In a reading, an assumption, an
interpretation, or a constraint nobody mentioned.

Every source below fails in its own specific way. Knowing the failure mode is what
lets you check the right thing.

| Source | How it fails |
| --- | --- |
| **The person reporting the bug** | Describes what they SAW, which is true, and why it happened, which is a guess. They may have missed a detail, or not know a constraint exists elsewhere. Their observation is evidence; their diagnosis is a hypothesis. |
| **Another agent's report** | Overstates, and marks things "verified" that it inferred. One agent's conclusion is a lead, never a finding. |
| **Your own earlier conclusion** | Written before you read the next file. Re-derive it when new evidence arrives instead of defending it. |
| **A passing test suite** | Proves the assertions agree with the code, not that the feature works. |
| **A document, including this one** | True when written. Documentation drifts and nobody notices. |
| **A green pipeline** | Says the code compiles and the asserted behaviours hold. Silent on every behaviour nobody asserted. |

## Attack negative claims hardest

"Not reachable." "Already covered." "That cannot happen." "No user does this."

**These are the highest-value statements to be wrong about**, because believing one
closes an investigation. Accepting a false "already covered" is how a real defect
survives review.

A worked example. An agent proved a particular state was unreachable, with genuine
file-and-line evidence about how the state machine worked. A reviewer refuted it in
one step, by noticing that a scheduled cleanup ended the state the proof depended on.
**The evidence was true. The conclusion was wrong.** Every negative claim deserves a
deliberate attempt to break it, ideally by somebody who did not write it.

## The lenses - run these on every change, not only when they seem relevant

A review scoped to "does the feature work" will never find the other seven.

1. **Does it work** - the stated behaviour, on every screen that uses it.
2. **Can somebody change an input to a decision that constrains them?** If a value
   acts as a permission boundary, ask who is allowed to write it.
3. **Can work be lost?** Dropped, overwritten, made unreachable, or reported as saved
   when it was not.
4. **What happens during the changeover?** Old code and new data serve people at the
   same time. What breaks in that window, and what does undoing it do?
5. **Does a new guard block honest work?** A rule that stops legitimate use is as
   damaging as the hole it closes, and it gets reported far less often. Attack the
   guard from the honest person's side too.
6. **Have you covered every path into the same decision?** If you bind one way of
   writing something to a rule, find every other way of writing it and bind those
   too. A guard on one path is not a guard.
7. **Is a claim about enforcement actually enforced?** If you say a rule is enforced,
   name the code that enforces it. If nothing does, call it a convention. A sentence
   in a document enforces nothing.
8. **Is the scope right?** See below.

## Challenge the scope BEFORE building, not after

Review cannot fix work that should not exist. Before starting, answer in writing:
**what is the smallest change that satisfies what was actually asked, and what in
this plan is not in the ask?**

In one recorded case, a change grew to sixty-nine files and eight thousand lines
through six review rounds. Five of the six blocking findings the reviewer eventually
returned were defects in machinery nobody had requested.

## How to disagree

Be direct: "I disagree, because." Always offer an alternative - criticism alone is
not help. Back the objection with something concrete you read.

If they hear the objection and still want it, do it, and write down the risk. Their
call, on the record.

**When not to push back:** they have domain knowledge you lack about what people
actually need; the choice is purely a matter of taste; they have said they know the
trade-off. None of these exempt you from VERIFYING. They exempt you from arguing.

## Related

`facts-only.md` - claim only what you read. `less-is-more.md` - build only what is
needed. `what-checks-prove.md` - which evidence answers which question.
