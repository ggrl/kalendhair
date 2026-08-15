# ADR-0024: The repository is published as kalendhair, with its history and its workflow files

- Status: accepted and done, 2026-08-15
- Governs what ships publicly. Touches no running code.

## Context

The project was preparing to be published. The owner asked whether `AGENTS.md`,
`CLAUDE.md` and the rest of the agent instructions need to be uploaded at all, and then
proposed the fuller version of that: a brand new repository containing only the
application files, under a better name than `calendar`.

Two separate questions were tangled together - what gets published, and what it is
called - and they have different answers.

**On size, the premise did not hold.** Measured rather than assumed: 122 tracked files,
1.3MB in the working tree, and GitHub's own `diskUsage` for the repository at 620KB.
Every agent instruction file combined - `AGENTS.md`, `CLAUDE.md`, `rules/` and
`.claude/` - is 88KB, under 7% of the tracked bytes. `AGENTS.md` itself is 4KB. Deleting
the entire workflow would save 88KB of 1.3MB. The `.gitignore` was already excluding
everything large.

**On secrets, the history was audited and is clean.** This is the finding that removed
the only real argument for starting over:

- `.env` was never committed. No such blob exists in any commit on any branch - only
  `.env.example`, which is placeholder-only by design and says so in its own comments.
- No hardcoded credential in any of the 40 commits, across every branch.
- Every commit is authored as `226671839+ggrl@users.noreply.github.com`, not a personal
  address.
- Test data is invented names only, as `docs/PRODUCT_BRIEF.md` requires.

So there was no secret to burn and no history to rewrite.

## Decision

**The repository is renamed in place and keeps everything.** `ggrl/calendar` became
`ggrl/kalendhair` - Kalender plus hair, a wordplay, which the owner notes is what
hairstylists like. GitHub redirects the old URL, which was verified with `git ls-remote`
against the old address rather than taken on trust. All 40 commits, 41 pull requests, 24
ADRs, the work log and the full agent workflow stay.

**Three names that belonged to the template were replaced**, in `package.json`, its
lockfile twice, and `LICENSE`. The copyright holder is `ggrl`; `Cybersteps` was inherited
from the starter this repository was generated from and was never this project's. The
README heading takes the new name and keeps its descriptive sentence, because
`kalendhair` says what the thing is only to somebody who reads German.

## What was rejected, and why

**A fresh repository with only the application files.** This is the one worth recording,
because it will be proposed again by somebody looking at `.claude/` and seeing clutter.

A React and Node appointment board is not rare. What is rare here is the record around
it: 24 ADRs that each write down the tempting wrong answer, a work log, and a documented
case where two review passes ran against a fully green 158-test suite and the logic pass
still returned NO-SHIP over a keyboard trap that made the entire top bar unreachable by
Tab. Publishing the application alone publishes the ordinary half and discards the half
worth reading. The README already cites that history as evidence for its own claims.

**Keeping the history but stripping the agent scaffolding.** Rejected for a mechanical
reason on top of the above: `.claude/hooks/no-main-commit.sh` goes with it, and the
README's own honesty table labels that hook the single rule in this repository that
**Blocks** rather than merely reminds. Removing the scaffolding would delete the only
enforced rule here, take `/start`, `/save` and `/grill-me` with it, break four README
links, and leave every future session starting blind.

**Renaming the working directory on disk.** Left as `~/Documents/git/calendar`
deliberately. Git does not care, the remote is correct, and moving it is the owner's to
do from outside a session that is running inside it.

## Consequences

**The workflow is now part of what is published.** Anyone reading this repository reads
`AGENTS.md`, the two gates, and every ADR including this one. That is the intent, and it
means the instructions are now a public artifact held to the same standard as the code.

**The name is opaque outside German.** `kalendhair` reads as a calendar to an English
speaker only by accident of spelling, which is why the README's descriptive sentence
directly under the heading is load-bearing rather than decoration.

**The rename commit merged without review, and that was a choice.** PR #41 was pushed,
the reminder hook fired, and it merged on the owner's instruction with neither pass run.
CI was green on all three jobs and the change was four string literals touching no logic,
but section 3 of `AGENTS.md` carves out no exception for small changes. Recorded here so
the log does not later imply it was reviewed.

**The publishing blocker is unchanged and is not about publishing.**
`docs/PRODUCT_BRIEF.md` requires a backup that leaves the machine and one restore actually
performed before real customer data goes in. That gates real data, not visibility. The
repository can be made public whenever the owner wants: it is still private today.
