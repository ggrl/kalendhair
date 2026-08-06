---
name: start
description: Load this project's context at the beginning of a session, then say what you understand and wait. Run this FIRST in every new conversation, before answering anything.
---

# /start - load the project before you touch it

A new conversation remembers nothing. This loads enough to act safely, and no more.

**Budget: this whole routine should cost you a few minutes and a few thousand words.
If you find yourself reading the entire repository, stop - you have misread this
file.** A startup routine that demands more reading than fits in your head is the
same failure as no routine at all.

## Step 1 - read these five things, in this order

1. `AGENTS.md` - the rules you work under. All of it.
2. `README.md` - what this repository is and how to run it.
3. `WORK_LOG.md`, if it exists - the note the previous session left behind, written
   by `/save`. Read the top entry first: it says what was finished, what was not,
   and what it thought should happen next. A fresh clone has no work log yet.
4. `docs/PRODUCT_BRIEF.md`, if it exists - who the application is for and what it is
   deliberately not doing. A fresh clone of this template has no application yet, so
   this file will not exist until one is built; that is expected, not a broken read.
5. `docs/adr/`, if it exists - list the files, read the titles, and read in full only
   the ones that govern what you are about to touch.

Do NOT read every rule file in `rules/` now. Each one says at the top when it
applies. Load it at the moment you are about to do the thing it governs. That is the
point of splitting them up.

## Step 2 - look at the current state

```bash
git status --short
git log --oneline -10
git branch --show-current
```

If there is uncommitted work you did not create, say so and do not touch it. If the
current branch is the main branch, say so - work belongs on a branch.

## Step 3 - check that the project actually runs

```bash
npm ci
npm run verify
```

If anything fails here, **that is your finding and you report it before doing
anything else**. A red baseline means every result after it is meaningless: you will
not know whether you broke something or found it broken.

## Step 4 - say what you understand, then stop

Report, in under two hundred words:

- what this project is, in one sentence;
- what state it is in: branch, last commit, whether the checks pass;
- what the previous session left unfinished, if `WORK_LOG.md` says so;
- anything that looks wrong or unfinished;
- what you think the next sensible step is.

Then **wait**. Do not start work. Do not write code. Do not commit. The person asked
you to load context, and that is all.

## What to do next, once they answer

If their request is small, clear, and you can name what "done" looks like: do it.

If it is a feature, a change of behaviour, or anything where two readings would lead
to different code: **run `/grill-me` first.** Do not start building on a guess. That
is the single most expensive mistake available to you, and it is free to avoid.

## Related

`/grill-me` before building. `/save` when you finish.
