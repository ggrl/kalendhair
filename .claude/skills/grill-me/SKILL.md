---
name: grill-me
description: Interview the person before building anything. Ask hard, concrete questions about what they actually want, surface the things they have not thought of, and only then write down a brief. Use before any feature or behaviour change.
---

# /grill-me - interrogate the request before you build it

**The role reverses here. You ask, they answer.** Most bad software is not badly
written; it is a correct answer to the wrong question. This is how you avoid that,
and it costs minutes instead of days.

## Your two jobs

1. **Interrogate the request.** Find out what they actually want, which is rarely
   what they first said.
2. **Bring what they did not ask about.** They know the tip of the problem. Finding
   the rest is your job: the edge cases, the thing that breaks, the decision nobody
   has made yet, the consequence they cannot see from where they are standing.

## How to do it

**Open by stating the request back in one sentence**, as you understood it. If it is
already wrong, you learn that immediately and for free.

**Then ask, hardest first, no more than three at a time.** Every question must be
concrete and answerable. "Which of these two things should happen when the queue is
empty?" is a question. "Any preferences?" is not.

**Every round must include at least one thing they did not raise**, with your
recommendation attached. That is the part that earns this skill its cost.

**After each round, say back what you now understand, in two or three lines.** A
wrong restatement is the most valuable thing you can produce - it lets them correct
you before it becomes code.

**Do not build, design or write code during the interview.** Proposals are allowed
only as options inside a question.

## The questions that actually find things

- Who is this for, and what are they trying to finish? Not "the user" - which person,
  doing what?
- What are they doing today instead, and why is that bad?
- What is the most expensive way this could go wrong?
- What must never happen, even if everything else works?
- How will we see that it worked, without trusting anybody's word for it?
- What is explicitly NOT part of this?
- What happens on the awkward inputs: nothing there, one thing, far too many, someone
  pasting something strange?
- Which existing behaviour could this break?
- If this turns out to be wrong in a week, what does undoing it cost?

## Stop when

They say stop, or two rounds in a row produce no correction. Do not keep asking to
look thorough. An interview that outlasts its usefulness is the same waste as no
interview.

## Then write the brief - eight lines, no more

- **Actor** - who this is for.
- **Observation** - what is happening now, that somebody actually saw.
- **Outcome** - what must become true. Not how.
- **Mechanism** - how you propose to get there. **This is a hypothesis, not a
  decision.** The person owns the outcome; you own the mechanism, and you may be
  talked out of it by evidence.
- **Examples** - the ordinary case, and the awkward ones you found above.
- **Non-goals** - what this is deliberately not doing. Be specific; this section
  prevents more waste than any other.
- **Permissions** - what you may touch, and what you may not.
- **Done when** - the evidence that ends the task. Something checkable, not "it works".

Show them the brief. Get a yes. Then build.

## One warning

If the request contains a solution rather than a problem - "add a delete button", "use
a database", "make it faster" - your first job is to find the problem underneath it.
Very often the stated solution is wrong and the underlying need is real and simpler.
Ask what they saw that made them ask for it.

## Related

Run after `/start`, before any code. `/save` when the work is finished.
