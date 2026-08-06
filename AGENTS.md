# Agent instructions

> **Audience:** any AI coding agent working in this repository - Claude Code, Codex
> CLI, Cursor, or whatever comes next.
> **Read this top to bottom before doing anything.**

This file is the entry point. It is deliberately short. The detail lives in
`rules/`, and you load a rule when you are about to do the thing it governs.

---

## 0. Start here, every session

Run `/start`. It loads the project context: what this is, what state it is in, and
what was last worked on. If you have not run it, you do not have enough context to
act, no matter how obvious the request looks.

When you finish, run `/save`. It writes down what happened so the next session - which
will remember nothing - can pick up where you left off.

---

## 1. The two gates, in order

Every line of code passes both, in this order, before anything else applies.

**Gate 1: LESS IS MORE.** You may not write a single unnecessary character. Before
adding anything, answer: which real behaviour breaks without it, is the scenario
observed or invented, and does a mechanism already exist. Never build a defence for
an invented scenario - report it in one sentence instead. Detail: `rules/less-is-more.md`.

**Gate 2: FACTS ONLY.** Never guess. You may not state a cause or a mechanism you
have not read - in this code, in the dependency's source, in the vendor's docs, in a
log, or in a request you actually made. A claim without a citation does not get
written. Detail: `rules/facts-only.md`.

These two outrank everything below, including your own sense of thoroughness.

---

## 2. Before you build

**Ask first, if the answer changes the work.** If two readings of a request lead to
materially different code, ask. One question at a time, with the options laid out and
a recommendation. "Which do you prefer?" with no options is not a question.

**But check whether you can answer it yourself first.** You have a shell, the
repository and the tools. A question you could settle with one command costs somebody
their attention and buys nothing. Ask only about things the system cannot tell you:
what somebody WANTS, which trade-off they prefer, whether a scenario is real.

**Read the decision log.** `docs/adr/`, when it exists, holds settled rulings. Before changing
something in an area an ADR governs, read it and follow it. If it needs to change,
write a new one that supersedes it. Never silently re-decide.

---

## 3. How work ships

- Work on a short-lived branch. Never commit straight to the main branch. For
  Claude Code this is enforced by a hook (`.claude/hooks/no-main-commit.sh` - only
  exit 2 blocks); every other tool relies on you reading this line.
- Run the full check before every commit: `npm run verify`. All of it green, no
  exceptions, and never remove a check to make it pass.
- Open a pull request. Before it merges, the change gets **TWO review passes**, each
  by a mind that did not write it. An author checks whether the code does what they
  intended; a reviewer checks whether the intention was right. One mind does not ask
  both questions at once.
  1. **Logic pass** - does it do the right thing, and what did the author not think
     to check.
  2. **Security pass** - only holes: input reaching a request or the page unescaped,
     a secret in code or config, data sent where the user did not ask, a public
     endpoint a stranger could abuse.

  If you have a second, independent tool (Codex CLI, for example), let it run a
  pass - a different model has different blind spots than the one that wrote the
  code. If you do not, use the agents this repository ships:
  `.claude/agents/reviewer.md` (logic) and `.claude/agents/security-reviewer.md`
  (security). Honesty about what holds this: it is a convention, enforced by
  reading this file plus a reminder hook on `git push` - not a hard block. A push
  without review is a choice, not an accident.
- Two more agents are helpers, not gates: `.claude/agents/researcher.md` checks a
  fact against the live source before it gets written down, and
  `.claude/agents/ux-reviewer.md` walks a UI change as a person seeing the screen
  for the first time.
- Merge, then verify the running result, not the pipeline's opinion of it.

**A green pipeline proves the assertions somebody wrote. It says nothing about the
behaviours nobody thought to assert.** See `rules/what-checks-prove.md`.

---

## 4. Secrets

No key, token, password or connection string goes in a file that gets committed.
Not in code, not in config, not in a comment, not echoed into a log. If one ever
touches version control, it is burned and must be replaced - history is permanent.
Detail: `rules/secrets.md`.

---

## 5. Shape of the code

One domain module owns one job and hides how it does it. Callers use a small,
deliberate interface and never reach inside. A business rule lives in exactly ONE
place; if you find yourself writing the same decision in a second file, that is a
defect, not thoroughness.

This branch has no domain module yet - see section 8. The `example` branch's
`src/report-triage/` is a worked instance of the principle: it owns what a verdict
is, which verdict may follow which, what a valid report looks like, and where
reports are stored, and the user interface knows none of that. Detail:
`rules/coding-standards.md` and, on that branch, `docs/adr/ADR-0001-*.md`.

---

## 6. Trust nothing until you have checked it

Not the person reporting the bug - they describe what they SAW, which is true, not
why it happened, which is a guess. Not another agent's report - agents overstate and
mark things verified that they inferred. Not your own conclusion from ten minutes ago,
written before you read the next file. Not a passing test suite.

Attack your own negative claims hardest. "Not reachable", "already covered", "cannot
happen" are the highest-value statements to be wrong about, because believing one
closes an investigation. Detail: `rules/critical-thinking.md`.

---

## 7. Writing

Plain language. No emoji. Never an en dash or em dash - use a hyphen or a colon.
Comments explain a decision that is not obvious from the code, never restate what the
line already says.

---

## 8. What this repository is

A clean workflow shell, not an application. `src/` holds a one-page placeholder and
`tests/` holds one placeholder test per harness (unit and browser), each named and
commented as something to delete once real code exists to test. There is no product
here yet - that is the point, not an oversight.

**The toolchain is ready.** TypeScript, ESLint, Vitest, Playwright and the CI
workflow all run today, against the placeholder, exactly as they will against
whatever gets built here next. `npm run verify` passing on a fresh clone is a fact
about the harness, not about a feature.

**The `example` branch holds a finished worked example** - a small phishing-report
triage queue, built with this same workflow end to end. Look there to see what a
finished change through this process looks like before you build your own.
