---
name: save
description: Write down what happened in this session so the next one, which will remember nothing, can continue. Run after finishing a piece of work, before ending a session, or when the conversation is getting long.
---

# /save - leave a note for the next session

Your memory ends when this conversation ends. The next session starts from zero and
reads files. **A note in a file survives. A note in the conversation does not.**

This is also what you do when a conversation has run long and is getting muddled: save,
start fresh, and let `/start` reload you. That is cheaper and more reliable than
struggling on in a session that has lost the thread.

## Step 1 - verify before you write anything down

You are about to record claims that the next session will trust without checking.
So check them now.

```bash
git status --short
git log --oneline -5
npm run verify
```

**Only write down what you can point at.** If you did not run a check, do not say it
passed. If a test failed, that goes in the note - a note that records only successes
teaches the next session a lie, and it will act on it.

## Step 2 - write to `WORK_LOG.md`

Append at the top. Newest first, so the next session reads the current state before
the history.

```markdown
## <date> - <what this session was about, in five words>

- What changed, and where. Name the files.
- Why. The reason, not the diff - the diff is in git already.
- What was verified, and how. Name the command and its result.
- What was NOT verified, and why not.
- What is unfinished, and what the next step is.
- Anything that surprised you.
```

That fourth line is the one people skip and the one that matters most. "The checks
pass but nobody has opened this in a browser" is worth more to the next session than
three paragraphs of description.

## Step 3 - if a decision was made, record it separately

A decision is a ruling you would otherwise re-litigate in three weeks: a choice
between two designs, a rule about how something works, something ruled out on purpose.

Those go in `docs/adr/` as their own short file - context, decision, alternatives
considered, consequences - not buried in the work log. **A decision recorded only in
a work log will be lost, and then quietly re-decided differently.**

## Step 4 - commit, if there is code to commit

```bash
git switch -c <branch-name>   # if you are still on the main branch
git add <the specific files>  # never `git add -A`, it sweeps up things you did not mean
git commit -m "<what changed and why>"
```

Stage explicit paths. `git add -A` is how secrets, scratch files and half-finished
experiments get committed by accident, and version control is permanent.

## What this skill may NOT do

- It may not push, publish, or deploy anything. Those are somebody's decision, not a
  side effect of writing a note.
- It may not report work as done that you did not verify.
- It may not quietly fix something it noticed on the way. Write it down and leave it.

## Related

`/start` reads what this writes.
