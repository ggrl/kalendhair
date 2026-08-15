# Work log

Newest first. Read the top entry before doing anything.

## 2026-08-16, twelfth session - it deploys with one command, and three review rounds to get there

Continues the entry below, which is now history rather than current state: everything it
called unmerged is merged, and the repository is `kalendhair`.

### Where things stand

- **`main` is at `c65f50e`**, working tree clean, no open pull requests, only `main` exists
  local and remote. PRs #42 and #43 merged today.
- **The repository is `github.com/ggrl/kalendhair`**, still **private**. The old `calendar`
  URL redirects.
- **Twenty-five ADRs.** ADR-0025 is new: the proxy is Caddy and stays on the host.
- **Deployment is `docker compose up -d --build`.** The server needs Docker and git and
  **no Node** - the image builds itself.
- **The blocker on real customer names has not moved**: no backup that leaves the machine,
  no tested restore. `DEPLOYMENT.md` step 10 now tells you exactly how to close it.

### What was built, and where

- **`DEPLOYMENT.md`** (#42) - server deployment start to finish with TLS, provider neutral,
  written from this code rather than from a template. Includes a section on running the
  Azure test box without buying a domain.
- **`Dockerfile`, `.dockerignore`, an `app` service in `docker-compose.yml`** (#42) -
  implementing ADR-0005, which always specified two services and only ever had one.
- **`docker-compose.dev.yml`** (#42) - the loopback database port and the `salon_test` seed,
  the two things only a development machine needs. `npm run db:up` passes both files.
  ADR-0006 amended to record it.
- **`docs/adr/ADR-0024`** (#43) - what gets published and why. **`ADR-0025`** - this session.

### What the owner decided

- **`kalendhair`**, their own wordplay, and rename in place rather than a fresh repository.
- **Compose profiles for the database port** - which turned out not to be implementable as
  asked (profiles gate whole services, not one `ports:` entry), so the same outcome was built
  with an override file. Said out loud rather than silently substituted.
- **The proxy stays on the host** rather than joining compose. ADR-0025.
- **Merge #41 without review**, after being told it had none.
- **Three full review rounds** on the deployment branch, then merge.

### The review rounds, because the shape of them is the useful part

| Round | Logic | Security |
| --- | --- | --- |
| 1 | NO-SHIP - 2 blockers, 3 false claims | SHIP, 2 conditions |
| 2 | NO-SHIP - 2 blockers, **both introduced by round 1's fixes** | SHIP |
| 3 | SHIP | SHIP |

- **The `$` trap, and it was mine.** `env_file` expands `$` in a value; `node --env-file`
  does not. `SALON_PASSWORD=Sommer2026$Salon` seeded as `Sommer2026`, passed the length
  rule, and printed the same success line a correct start prints. ADR-0017 makes seeding
  one-time, so the salon would have been locked out permanently and `MASTER_PASSWORD` -
  the way back in - truncates the same way. Single quotes are the only form both loaders
  agree on. `#` breaks it in the opposite direction and double quotes do not protect at all.
- **Round 2's blockers were in round 1's fixes**, both in the backup section the brief makes
  blocking. The dump could not fail visibly (no `pipefail`, so a stopped database produced
  exit 0 and a *valid* gzip holding zero bytes), and the restore drill could not read its own
  backups (the directory was correctly made `700`, and the `gunzip` left running as the
  admin).
- **A reviewer's own fix was wrong and testing caught it.** It proposed `set -o pipefail`
  inside `sh -c`; `/bin/sh` is dash on Debian and Ubuntu, which answers `Illegal option`.
- **I disagreed with a finding and was right.** It said a compose override *replaces* the
  volumes list. `docker compose config` shows it appends and dedupes by target.

### What was verified, and how

- On merged `main` at `c65f50e`: `npm run verify` green (**116 unit**), `npm run test:db`
  green (**144**). CI green on all three jobs for #42 and #43 before merge.
- **The stack was run, repeatedly, not reasoned about.** Five migrations apply to a fresh
  volume, credentials seed, board `200`, unauthenticated day `401`, login `204` and wrong
  password `401`, cookie `HttpOnly Secure SameSite=Lax`, production database holds only
  `salon`. Always under a throwaway project name so the dev volume was never touched.
- **The backup script was extracted from `DEPLOYMENT.md` with `awk` and run as documented**:
  cannot be modified by the account that runs it, exit 1 and no final-named file when the
  dump fails, exit 0 at mode `600` when it works, and it fires from a real cron daemon for a
  `nologin` account.
- **Step 4's failure and its fix were both reproduced on `ubuntu:24.04`.**
- **A nonexistent `HOME` does not break `docker compose` on Linux** - the reviewer could only
  reproduce that on macOS, so it was settled with Docker's own packages on Ubuntu. The plugin
  lives in `/usr/libexec/docker/cli-plugins` and returns exit 0.

### What was NOT verified, and why not

- **Nothing has run on a real server.** Every deployment step was tested on macOS with Docker
  Desktop or in an `ubuntu:24.04` container. `DEPLOYMENT.md` has never been executed
  end to end on a VM, and until it has it is a hypothesis.
- **Caddy has never been put in front of the board.** So the whole TLS section, and the
  `trust proxy` consequence in particular, is read from code and vendor documentation rather
  than observed. All three review rounds said the same.
- **No `iptables` claim was proved.** The reviewers were on macOS too. The guide no longer
  rests anything on `ufw` for this reason.
- **Nobody opened the board in a browser this session**, and no `test:e2e` run happened
  locally. CI ran the browser job green on both PRs, which is a real signal and not the same
  thing.
- **PR #41 merged with neither review pass**, on the owner's instruction after being told.

### Unfinished, and the next step

- **`trust proxy` is the one real blocker for production.** `server/app.ts` keeps three
  counters keyed on `request.ip` - login 20/5min, master-password reset 20/5min, wrong PIN
  10/5min. Behind a proxy Express is not told to trust, all three become one budget shared by
  the internet: a stranger holds the salon out of its own board *and* out of the recovery
  door at about four requests a minute. The fix is `app.set('trust proxy', 1)` and it must be
  a hop count - `true` makes `X-Forwarded-For` whatever the caller claims, removing all three.
  **This is the next thing to build.**
- **Month steps** remain the one navigation piece not started. ADR-0010 already settled the
  arithmetic.
- **The backup and one tested restore** still gate real customer data.
- **The working directory is still `~/Documents/git/calendar`** while the repository is
  `kalendhair`. Cosmetic; needs doing from outside a session running inside it.

### What surprised me

**Fixing things is how the next defect gets in.** Round 1's fixes carried round 2's blockers,
and both landed in the backup procedure - the one section the product brief makes blocking
before real customer data. Then, writing the fix for round 3's "nobody hears the failure"
finding, I claimed the cron log inherits the script's `umask`. It does not: cron's shell
creates the file before the script runs, so it landed at `664` while the dumps were `600`.
Three rounds in, still shipping a false claim in the sentence that fixes a false claim. The
only thing that caught any of it was running the commands rather than reading them.

## 2026-08-15, eleventh session - the project has a name, and the history was audited to publish

No application code changed. This session was about preparing to publish, and the useful
output is a finding and a name.

### Where things stand

- **The repository is `github.com/ggrl/kalendhair`**, renamed from `calendar`. Still
  **private**. The old URL redirects - checked with `git ls-remote`, not assumed.
- **`main` is at `0ebf0f0`**, working tree clean, no open pull requests, only `main` exists
  local and remote. PRs #40 and #41 merged.
- **Twenty-four ADRs.** ADR-0024 is new: what gets published and why.
- **The blocker on real customer names still has not moved**: no backup, no tested restore.

### What the owner asked, and what the numbers said

The question was whether `AGENTS.md`, `CLAUDE.md` and friends need uploading at all, then
whether to start a fresh repository with only the application files under a better name.

**The size premise did not survive measurement.** 122 tracked files, 1.3MB in the working
tree, 620KB by GitHub's own `diskUsage`. Every agent file combined is 88KB, under 7%.
Deleting the whole workflow would have saved 88KB. `.gitignore` was already correct.

**So the real question was the history, and it is clean.** Audited rather than assumed:
`.env` has never been committed - no such blob exists on any branch, only `.env.example`,
which is placeholder-only. No hardcoded credential in any of the 40 commits. Every commit
is authored as the GitHub noreply address, not a personal one. Test data is invented names.

That is the finding worth keeping: **there is nothing in this history that cannot go
public.** A future session preparing to publish does not need to redo this audit.

### What changed, and where

- **The name.** `package.json`, `package-lock.json` twice, and the `README.md` heading now
  say `kalendhair` - Kalender plus hair. `cybersteps-training-starter` was the template's
  name and appears nowhere now: `git grep cybersteps` returns nothing.
- **`LICENSE`** reads `Copyright (c) 2026 ggrl`. `Cybersteps` was inherited from the
  starter and was never this project's.
- **`docs/adr/ADR-0024-*.md`**, recording the rename-in-place decision and, more usefully,
  the two alternatives rejected and why.

### What the owner decided

- **`kalendhair`**, their own wordplay - "hairstylists love wordplays".
- **Rename in place rather than a fresh repository**, keeping the history and the agent
  scaffolding, on the argument that the record is the distinctive part and a salon board in
  React is not.
- **`ggrl` on the copyright line** rather than a legal name.
- **Merge #41 without the two review passes**, after being told it had none.

### What was verified, and how

- On merged `main` at `0ebf0f0`: `npm ci` clean and `npm run verify` **green - 116 unit
  tests, build clean, 0 vulnerabilities**, now reporting `kalendhair@0.1.0`. Run after the
  merge, not only before it.
- CI green on all three jobs - `verify`, `database`, `browser` - for both #40 and #41.
- `npm ci` accepts the hand-edited lockfile, which was the one way a name change could
  have broken something.
- The old GitHub URL still resolves to `8d2996e` via `git ls-remote`.

### What was NOT verified, and why not

- **`npm run test:e2e` and `npm run test:db` were never run locally this session.** CI ran
  both green on each PR, which is a real signal, but it is not the same as running them.
- **Nobody opened the application in a browser this session.** No reason to think a string
  rename would change a pixel, and equally nothing here proves it did not.
- **PR #41 had zero review passes.** The push hook fired its reminder; it merged anyway on
  instruction. Four string literals, no logic touched, CI green - but `AGENTS.md` section 3
  carves out no exception for small changes, and this was an exception.

### Unfinished, and the next step

- **Month steps** remain the one navigation piece not started. ADR-0010 already settled the
  arithmetic, so the ruling exists and only the work is missing. This is the obvious next
  piece of product work.
- **The backup and one tested restore** still gate real customer data. Unchanged for three
  sessions and it will not change by itself.
- **The working directory is still `~/Documents/git/calendar`** while the repository is
  `kalendhair`. Cosmetic, git does not care, and it needs doing from outside a session
  running inside that directory.
- **The repository is still private.** Making it public is a switch whenever the owner
  wants it - nothing in the code or history blocks it.

### What surprised me

**`gh repo rename` updated the local git remote by itself.** I had written out a
`git remote set-url` for the owner to run and it was already unnecessary. Checked after,
which is the right order - the instruction would have been harmless, but it would have been
advice I had not verified.

## 2026-08-15, tenth session, second half - the boxes say more, and the review found a blocker

Continues the entry below, which stopped at six changes and said none of them had been reviewed.
Both statements have since expired: three more changes went in, then **both review passes ran over
the whole span and the logic pass returned NO-SHIP**. Everything it found is fixed and merged. So
is a tenth thing it did not find, which the owner did, by opening the date picker.

### Where things stand

- **`main` is at `8d2996e`** and is the only branch anywhere. PRs #37, #38 and #39 merged after the
  ones listed below. Working tree clean, no open pull requests, remote branches pruned.
- **Twenty-three ADRs.** ADR-0023 is new: what a box says about itself.
- **The blocker on real customer names has not moved**: no backup, no tested restore.

### What was built, and where

- **Every box says how long it lasts** (#37). `formatDuration` in `src/calendar/grid.ts` - `15m`,
  `45m`, `1h`, `1h15` - and `src/ui/EntryBox.tsx` draws it top right, or on the line when the box is
  too short to have a corner. Computed from the slots being *drawn*, so it follows a drag.
- **A note is a folded corner** (#38). `.entry__fold`, 15px, `--ink`, bottom right. It replaced a
  dot, which replaced the word `Notiz`. The word survives as `visually-hidden` text, because a
  shape says nothing to a screen reader.
- **Everything the review passes found** (#39), listed below.

### What the owner decided

- **A dot for the note, then a fold instead** after seeing the dot on the running board: "very
  small and no good visual clue". 15px was their number, and they accepted that it clips the tail
  of `15m` on the shortest box after seeing that at four times scale.
- **Blocks show a duration too**, against my recommendation of appointments only.
- **The duration on the right of every box**, including the short ones - a correction after seeing
  it beside the start time first.
- **The whole span reviewed at once** rather than nine separate passes.

### What the review passes found

The logic pass: **NO-SHIP**. The security pass: **SHIP**, having checked the one rule that matters
most here - `entry.notes` reaches neither the DOM, nor the `title`, nor the accessible name.

- **The blocker, and it was mine.** The 08:00 landing used `scrollIntoView`, which sets the
  browser's sequential focus navigation starting point to the element it scrolls to. So the first
  Tab after every load continued from the hour scale *inside* the board: Tab, Enter opened a
  customer's form, and the entire top bar was unreachable by tabbing forward. **I had seen the
  symptom while building it and written it off in a test comment as ordinary browser behaviour.**
  `Board.tsx` now sets `scrollTop` directly and subtracts the measured height of the headings.
- **A day with nobody on it cost the next day its landing.** Grid unmounts, scroll resets, flag
  survives: staffed day, empty day, staffed day arrived at 06:00.
- **One finding refuted with evidence.** The pass said the open date picker lets the board step
  behind it. A capture-phase listener on `window` sees *no* keydown at all while the popup is open -
  the native calendar takes the key and the board follows through `onPick`. Their own numbers agreed
  on a second reading: one day per press, Shift ignored, and the handler makes Shift a week. A guard
  was written, measured, and reverted.
- ADR-0022 promised an assertion that was not in the file; the strip-width comment recorded a best
  case when **widening the window from 1308px to 1424px actually narrows the board** by 112px;
  three comments described a dot that had been deleted, one duplicated verbatim; `formatDuration`
  claimed a length it can exceed; one assertion could not fail; and the dead yellow note-panel
  stylesheet - which draws note text on the board - was deleted at the security pass's request.

### What the passes did not find, and the owner did

**The date picker opened 573px to the right of its own glyph**, and off the edge of a narrow
window. The browser hangs its calendar off the hidden `<input>`, which was positioned against
`.topbar__heading` - fine while that was the middle column of a three-column bar, wrong the moment
this session made it span the whole width. The glyph and the field share a wrapper now, asserted at
five widths.

That is the shape of the gap `rules/what-checks-prove.md` describes: a green suite, two review
passes, and the defect was found by somebody pressing the button.

### What was verified, and how

- On merged `main` at `8d2996e`: `npm run verify` green (116 unit), `npm run test:e2e` green
  (**158**), `npm run test:db` green (144). CI green on all three jobs for #37, #38 and #39.
- Six more mutations on the fixes, all caught: `scrollIntoView` restored, the landing flag never
  released, the headings clearance dropped, the picker field positioned against the heading again,
  and the two behind the earlier findings.
- The picker fix was confirmed by the owner on their own screen before the branch was pushed.

### What was NOT verified

- **The fix branch itself had no review pass.** It is the product of a review, which is not the
  same thing, and it contains the riskiest change of the session: `scrollIntoView` replaced with
  arithmetic over measured element boxes.
- **Nothing has been re-measured on a real phone**, only in Playwright's iPhone emulation.
- **The salon still has not run a day on any of it.**
- The reviewer's own parting question is unanswered: force a 401 during a held drag and watch
  whether `gesturing` clears. Reasoned to self-heal on remount; not reproduced.

### Unfinished, and what comes next

1. **Deployment** - the container and the VPS, still blocked by the brief's backup gate: a backup
   that leaves the machine on a schedule and one restore actually performed.
2. **Month steps**, still unbuilt and deliberately kept out of the arrow keys.
3. The items named and deliberately not fixed in ADR-0018, ADR-0019 and ADR-0021.

### What surprised me

- **I wrote the bug and then wrote the excuse for it.** The Tab regression was in a test comment,
  described accurately, and dismissed in the same sentence. A reviewer who had not built it took
  two keystrokes to see what it cost.
- **A review finding can be wrong and still be worth having.** The date-picker finding sent me to
  measure something I would never have measured, and the measurement is now a test.
- **Two of my own tests could not fail**, again - the fifth and sixth of the session.

## 2026-08-15, tenth session - six interface changes, and none of them reviewed

**Superseded in part by the entry above**: three more changes followed, both review passes then ran
over the whole span, and "none of them reviewed" stopped being true. Read the entry above first.

The owner's GUI list, worked through one change at a time: they name it, I price it, they decide.
Six merged. **Read the "what was NOT verified" section before trusting any of it** - this session
shipped more unreviewed code than every previous one put together, deliberately and on the record.

### Where things stand

- **`main` is at `362c19d`** and is the only branch anywhere. PRs #29 through #35 merged in order;
  #29 was the previous session's log entry, which had never been opened as a pull request. Working
  tree clean, no open pull requests, remote branches pruned.
- **Twenty-two ADRs.** ADR-0022 is new and records what the day-step strips are - and, more
  usefully, the hot-zone design that was priced and ruled out.
- **The blocker on real customer names has not moved**: no backup, no tested restore.

### What was built, and where

Six changes, oldest first:

- **The board opens at 08:00** (#30). `Board.tsx`: `OPENS_AT`, a ref on that hour label, a
  once-guarded effect calling `scrollIntoView`. The bookable day starts at 06:00 and the salon
  rarely works before eight, so every session began by scrolling past two empty hours. It scrolls
  and refuses nothing: 06:00 is one scroll up and still bookable.
- **Round ends on the word buttons** (#31). `Heute` and the two week steps, `border-radius: 999px`.
  A radius past half the height rather than a number to re-tune.
- **Arrow keys** (#32). `App.tsx`: one `keydown` listener calling the same `goTo` the edge buttons
  call. Left and right a day, `Umschalt` a week. `tests/keyboard.browser.test.ts`, nine tests.
- **The day steps lost their boxes** (#33, ADR-0022). Only the chevron, a one-way arrow cursor
  drawn as an inline SVG, and a strip that grows from 28px to 144px with the screen.
- **A bigger chevron** (#34), tied to the same measure as the strip so a phone keeps what it had.
- **The top bar rearranged, and the hour scale narrowed** (#35). One control row - week back,
  settings, `Heute`, add, week forward - with the date and `KW`/`Stand` line beneath it. The scale
  went 4rem to 2.5rem and gave 24px to the columns.

### What the owner decided

- **08:00 fixed, not each day's core hours.** Their reasoning, and it was right: per-day would put
  Tuesday at 09:00 and Saturday at 08:00, moving the board between days.
- **Arrow keys: a day, Shift a week.** Navigation beats the board's own sideways scrolling; up and
  down are left alone; a held key moves one day, not sixty; no month steps.
- **Nothing on screen says the arrow keys exist**, against my recommendation of a tooltip. Their
  call: they will tell the staff. The cost is that only staff who are told will ever use them.
- **The hot-zone design was dropped** once priced - see ADR-0022 for why.
- **Strips grow inside the 1600px shell**, not out to the glass.
- **On a phone the week buttons lose their words rather than taking a second line.** Chosen over my
  recommendation. The cost, recorded in the stylesheet: `«` `»` in the bar mean a week and `‹` `›`
  at the board's edges mean a day - four similar glyphs on a small screen.
- **No review passes at all.** Asked three times, including separately for the arrow keys because
  that one is behaviour rather than appearance. Declined each time.

### What was verified, and how

- On merged `main`, at the end of the session: `npm run verify` green (112 unit),
  `npm run test:e2e` green (**149**, up from 126), `npm run test:db` green (144). CI green on all
  three jobs for every one of the six pull requests.
- **About thirty mutations across the six changes. Six survived their first run**, and those six
  are the reason this section is worth reading: four were my own tests being unable to fail, and
  two survive on purpose. The four:
  - The modifier guard on the arrow keys. My test pressed right then left - a day forward and back
    land where they started, so it could not fail. It presses twice one way now.
  - The form guard. The form opens with a field focused, so the *field* guard caught the press and
    the form guard was invisible. There is now a press from `Abbrechen`, plus a separate test that
    presses an arrow mid-drag.
  - The field guard itself, until a test focused the hidden date input directly - the state
    `TopBar.openPicker` leaves the page in on a browser without `showPicker`.
  And the two that survive on purpose, both recorded where they live rather than papered over with
  an assertion invented to kill them:

  - `preventDefault` on the arrow keys. With focus on an appointment box, Chromium does not scroll
    the pane sideways even without it. It stays as insurance for the browsers the suite cannot run,
    and both the code and the test say so.
  - The chevron growing at a third of the strip's rate rather than at the strip's own rate. That is
    a bigger glyph sooner - taste, not a defect.
- **Measured rather than assumed:** an iPhone reports `hover: false` and `pointer: fine` false, so
  `@media (hover: hover)` cleanly separates a mouse from a finger; the top bar at 1440, 701, 700,
  390 and 320 after the rearrangement, for sideways overflow; `06:00` at 33.89px against a 33.6px
  content box, which is why the label padding shrank with the scale.
- Screenshotted at 1440px and 390px after every visual change.

### What was NOT verified

- **Nobody has reviewed any of this.** Six changes, `f625d9a..362c19d`, no logic pass and no
  security pass. The two agents can read the whole span at once, which is cheaper than six passes
  and sees the top bar's three rearrangements as one shape.
- **How the arrow cursor actually looks.** Playwright cannot screenshot a cursor. The owner judged
  it on their screen and accepted it; nothing in the suite would catch it changing on another
  platform.
- **Nobody but the owner has judged how any of it looks**, which is the right way round, but
  "better" here is still one person's word.
- **The salon has not run a day on any of it.** Every measurement is a stub or a fixture.

### Unfinished, and what comes next

1. **The review**, if the owner wants it: `f625d9a..362c19d` in one pass each.
2. **Then deployment** - the container and the VPS, still blocked by the brief's backup gate: a
   backup that leaves the machine on a schedule and one restore actually performed.
3. **Month steps**, still unbuilt and deliberately kept out of the arrow keys: ADR-0010's clamp from
   31 January does not reverse, and a modifier nobody can see is the wrong place to learn that.
4. The items named and deliberately not fixed in ADR-0018, ADR-0019 and ADR-0021.

### What surprised me

- **My own 08:00 scroll moved where the keyboard starts.** `scrollIntoView` sets the browser's
  sequential focus navigation starting point, so the first Tab after a load continues from inside
  the board and lands on the next-day strip rather than in the top bar. Ordinary browser behaviour,
  found while testing something else, and left alone.
- **A drag test of mine passed for the wrong reason for exactly one change.** The board opening at
  08:00 moved the grid under the coordinates it was pressing, so the press landed on the sticky
  column headings and started no gesture at all. It anchors to a visible hour now.
- **Three of my own tests could not fail when first written**, and all three looked green. That is
  the whole argument for mutating a test before trusting it, and it is the third session running in
  which the mutations found more than the tests did.

## 2026-08-14, ninth session - the first pass over the interface

Small, and a different way of working: **the owner names a change, I price it, they decide.** Two
went in. **More are coming next session** - the owner has further GUI and user-experience tunings
in mind and stopped here deliberately, not because the list was finished. Deployment waits behind
that, and the backup gate still waits behind deployment.

### Where things stand

- **`main` is at `14a6eb1`** and is the only branch anywhere. PR #28 merged both changes together;
  batching GUI tweaks onto one branch was the owner's call and is cheaper than a branch and a
  review pass each. Working tree clean, no open pull requests.
- **Twenty-one ADRs, unchanged.** Neither change needed a new one: ADR-0020 still rules that the
  picker is the browser's own, and only how it is opened changed.

### What was built, and where

- **The date picker is a glyph beside the date.** `src/ui/TopBar.tsx`: a small calendar button next
  to the heading, and the `<input type="date">` still there - transparent, one pixel, positioned
  under it. The field used to sit two inches from the heading and say the same date again.
- **The action row is `(cog) [Heute] (+)`.** Round icon buttons either side of the one word, in
  that order, with `aria-label`s because an icon has no text to be named by. The add button is now
  `Neuer Termin` rather than `+ Termin`, since the label is what a screen reader reads aloud.

### What the owner decided

- **Three dots were asked for and a cog was chosen instead**, once the reason was named: three dots
  promise a menu that opens under the finger, and this opens a whole screen.
- **`Heute` keeps its word** rather than becoming a third icon.
- **The date field's duplication was the thing to remove** - and the owner was told first that this
  does not fix `13/08/2026`, because the slashes live inside the native picker too.

### What was verified, and how

- On merged `main`: `npm run verify` green (112 unit), `npm run test:e2e` green (126),
  `npm run test:db` green (144). CI green on PR #28.
- **Six mutations, all caught**: the glyph not opening the picker, the input visible again, the
  input back in the tab order, the wrong button order, a missing `aria-label`, and a "circle" whose
  width and height differ.
- **Measured on the real server at both sizes.** The top bar is unchanged at 104px on desktop and
  **12px shorter on a phone**, because two words left the row and the date wraps less.

### What was NOT verified

- **Where the native calendar popup actually appears.** It is browser chrome, so Playwright cannot
  screenshot it. The input is positioned under the button so it anchors correctly by construction,
  and the owner has the running server.
- **Nobody but the owner has judged how any of it looks.** That is the right way round - the
  measurements are mine, the taste is theirs - but it means "better" here is one person's word.
- **Typing a date directly is gone.** The field allowed it; an icon does not. The native picker is
  keyboard-operable, so this is slower rather than closed, and it is the one real accessibility
  cost of the change.

### Unfinished, and what comes next

1. **More GUI and user-experience tuning**, next session. The owner has further changes in mind and
   the same working agreement applies: they describe, I price, they decide. Worth knowing what
   makes a change cheap here - colours, spacing and wording are minutes; anything touching the
   board's geometry or the top bar's layout is not, because tests assert exact grid rows and the
   top bar arrangement is three review findings deep.
2. **Then deployment** - the container and the VPS, blocked by the brief's backup gate: a backup
   that leaves the machine on a schedule and one restore actually performed.
3. Month steps and arrow keys, and the items named and deliberately not fixed in ADR-0018,
   ADR-0019 and ADR-0021.

### What surprised me

- **My cog was a sun.** Spokes radiating from the centre with no body ring is exactly what a
  sunburst looks like at 18px, and I only saw it by screenshotting the thing at four times scale.
  Code that says "circle plus eight radial lines" reads as a cog while you are writing it.
- **`showPicker()` has two constraints that would each have been a silent failure.** It throws
  without a user gesture, and it throws on a `display: none` element - so the obvious way to hide
  the field is the one way that breaks it. Both were measured before anything was built.
- **`toBeHidden()` passes a 1px transparent element.** The assertion I reached for first would have
  certified that the duplicate date was gone while it was still being rendered. Computed opacity
  and width are what a person would see; visibility as Playwright defines it is not.

## 2026-08-14, eighth session - polling, a date picker, and the board on a phone

Three features and three ADRs, and **seven review passes between them - five returned findings and
three returned NO-SHIP**. The board is now live-updating, reachable by date, and usable on a phone.
Deployment is the next thing, and the backup gate still blocks it.

### Where things stand

- **`main` is at `60d176c`** and is the only branch that matters. PRs #24 (polling), #25 (the date
  picker) and #26 (the phone board) merged in that order; #26 was rebased onto #25 by hand.
  Working tree clean, no open pull requests.
- **`docs/session-log-head` still exists, pushed and unmerged, and is superseded.** It carried a
  one-line correction to the entry below, which this entry makes redundant. Delete it.
- **Twenty-one ADRs.** ADR-0019 polls, ADR-0020 is the date picker, ADR-0021 puts the board on a
  phone - and ADR-0021 amends **ADR-0017** (the PIN now has a rate limit) and **reverses the
  brief's `mobile or touch support` non-goal**.
- **The PIN in `.env` is still a dead seed** - carried forward from the entry below, still true.
- **The blocker on real customer names has not moved**: no backup, no tested restore.

### What was built, and where

- **ADR-0019, polling.** `src/ui/App.tsx` gained a 30-second chained `setTimeout` for the day on
  screen, a held day applied when a drag or the form ends, and a failure counter; `TopBar.tsx` says
  `nicht aktuell` after two failures and lost `Aktualisieren`; `Board.tsx` reports whether a gesture
  is in flight. `tests/polling.browser.test.ts` drives it on a controlled clock.
- **ADR-0020, the date picker.** `<input type="date">` in the top bar. One place decides whether a
  date is real - `isSalonDate` in `App.tsx` - and the picker itself checks nothing.
- **ADR-0021, the phone.** `minmax(150px, 1fr)` columns with sideways scrolling, the board as its
  own scrollport, a `.board__scroller` wrapper giving both grids one width, a top bar that no longer
  declares a height it cannot keep, `+ Termin`, no dragging by touch, and a rate limit on the PIN in
  `server/app.ts`.

### What the owner decided, and what I recommended against

Three interviews. **Four of their answers went against my recommendation, and three of those were
better:**

- **Remove `Aktualisieren`** rather than keep it as an escape hatch. Right - the timer never stops
  trying, so it only ever saved thirty seconds.
- **A minimum column width with sideways scrolling** - their idea, not offered in any of my
  options. It removed the entire reason I was pushing a separate list view for phones.
- **150px rather than my 110**, and **one change rather than splitting the repairs out**.
- **Ten wrong PINs per five minutes, forgiving**, with their own framing: a bump, not a measure -
  "that is the login".

### What was verified, and how

- On merged `main`: fresh `npm ci` at 0 vulnerabilities, `npm run verify` green (112 unit),
  `npm run test:db` green (144), `npm run test:e2e` green (123). CI green on all three PRs.
- **Against the real server, not only the suite.** Two browsers on one day picked up an
  appointment neither of them made, in ~30s, with the date unchanged and no dimming. The picker
  jumped from 13.08 to `Mittwoch, 14. Oktober 2026` with the URL following. On an iPhone 13
  viewport: **24 of 24 boxes clipped before this session and 2 after**, columns 55px before and
  150px after, headings readable, zero drift, and both new controls driven together at both sizes.
- **Every fix has a test that fails without it**, checked one at a time.

### What was NOT verified

- **Nobody has held a real phone.** Everything is an iPhone viewport in Chromium with CDP touch
  events. Safari is not Chromium and iOS is not a viewport, and the iOS edge-swipe gesture
  competing with a sideways-scrolling board has not been observed.
- **The PIN limit is per address, and that is untested here.** `trust proxy` is deliberately unset,
  so the harness has one address to offer. When a proxy arrives it must be set to the specific hop
  or the limit becomes one budget for the whole salon.
- **The limiter is itself a way to hold the salon out of its own revocation screen**, which is what
  ADR-0021 names as the remedy for a lost phone. The master password is the way back.
- **The fix commits answering the reviews went in unreviewed - again, including the last one**,
  which was security machinery written after the pass that demanded it. The owner was told and
  chose to merge. Fifth session running.
- The picker's date format is the machine's and nobody has seen it on a salon machine; a 30-minute
  box still clips its third line by 2px on every screen and always did; the write path still does
  not check `active`.

### Unfinished, and what comes next

1. **Deployment** - the container and the VPS, which the owner named as the next thing. The brief's
   backup gate blocks it: a backup that leaves the machine on a schedule and one restore actually
   performed. That deploy is also when `COOKIE_SECURE` and `trust proxy` start to matter, and
   `trust proxy` is now load-bearing for two limiters rather than one.
2. Month steps and arrow keys - the last of the navigation aids. The picker does not replace them:
   a week or month step keeps the weekday.
3. The items named and deliberately not fixed, now in ADR-0018, ADR-0019 and ADR-0021.

### What surprised me

- **An assertion that something is absent proves nothing, and it caught me at least five times.**
  `toHaveCount(0)` and `not.toContainText` succeed the instant they are evaluated, so a board that
  had not yet received a response passed exactly as well as one correctly withholding it. Three
  polling tests, two phone tests and one login test all had to be rewritten before they could fail.
  **The rule this session earned: after asserting absence, wait for the thing that would have
  caused the presence.**
- **Two of my own mutation tests were broken and reported success.** One inserted a CSS declaration
  that a later one in the same rule overrode; one measured a full-width shell whose centre is the
  viewport's whatever happens to it. A mutation that does not mutate is worse than no mutation,
  because it certifies the test.
- **A review pass found a regression worse than the defect I was fixing.** The old phone board cut
  a stylist's name in half; my first fix labelled every column with the previous stylist's name.
- **Serial tests cannot see a concurrency hole.** My PIN limiter read its counter before the scrypt
  derive and wrote it after; a burst of 500 concurrent guesses performed 131 derives against a
  limit of ten. Five tests passed throughout.
- **A bounding box cannot see what is painted over it.** The top bar overlapped the headings by
  overflowing its own box, so geometry said everything was fine; `elementFromPoint` said otherwise.
- **A synthetic pointer event cannot drive `setPointerCapture`** - the pointerId is one the browser
  has never seen, so it throws and no gesture starts. A touch test built on `dispatchEvent` passed
  with the rule under test deleted.
- **I claimed a rule prevented a lost appointment and it prevented a message.** Chromium cancels
  touch drags itself, so the write was never reachable. Two failed mutations forced me to measure
  instead of assert, and ADR-0021 records the smaller true claim.

## 2026-08-14, seventh session - the salon sets its own core hours

ADR-0018 is finished. `CORE_HOURS` no longer exists, the hours are seven rows the salon edits
itself, and **the settings screen is done - all three parts of it**. Two review passes again, and
the logic pass again returned NO-SHIP on something no test and no live check of mine could see.

### Where things stand

- **`main` was at `6586d7a`** when this session ended: PR #22 merged the hours (`c7bf109`), PR #21
  the previous session's log, PR #23 this entry. It has moved on since - see the entry above.
- **Eighteen ADRs, and ADR-0018 is now fully built.** ADR-0015's "core hours are a constant"
  paragraph is dead prose kept for its reasoning; its consequence about silent staleness is closed.
  Both gained notes rather than being rewritten.
- **The one blocker on real customer names is unchanged**: still no backup and no tested restore,
  which `docs/PRODUCT_BRIEF.md` makes the condition. Loopback and no TLS, so fake names only.
- **Read this before opening the settings screen: the PIN in `.env` no longer works.** The salon
  password still does. The PIN was changed during this session from the screen, which is exactly
  what ADR-0017 says the seed does after first start. The way back if it is lost is the master
  password, and nothing else.

### What was built, and where

- **`migrations/005_core_hours.sql`** - seven rows keyed by ISO weekday, `opens_at` and `closes_at`
  nullable together, seeded with exactly what the constant held. Two structural constraints; the
  06:00-20:00 window deliberately **not** in SQL, because `grid.ts` owns it and a copy in a `CHECK`
  is a second place for it to disagree.
- **`server/hours.ts`** - the only reader and writer of that table. `readWeek`, `writeWeek` (all
  seven in one transaction), and `hoursOn`, which folds ADR-0016's holiday rule in so
  `Day.coreHours` is one answer rather than two rules a client has to combine.
- **`GET /api/day` gained `coreHours`**; `GET`/`PUT /api/settings/hours` sit behind the PIN guard.
- **`src/ui/Board.tsx`** draws `day.coreHours` and computes nothing. `Settings.tsx` gained the
  `Kernzeiten` section. `CoreHours` moved to `types.ts`, `germanWeekday` was added to `dates.ts`.

### What the owner decided, and what I decided

Six things the ADR had not said were asked, and all six are written into ADR-0018: one continuous
band per weekday rather than a lunch gap; quarter hours from a dropdown; one `Speichern` for the
whole week; a backwards or equal range refused by weekday name rather than read as closed; a German
line saying the hours colour the board and refuse nothing; and the stale open tab accepted.

Mine, also in ADR-0018: the server applies the holiday rule, 06:00-20:00 is checked against
`grid.ts` and not copied into SQL, and `germanWeekday` is formatted from a reference Monday so
there is no second spelling of `Mittwoch`.

**And then the owner changed the shading from red to grey on their own screen**, plus the settings
hint that had promised a red board. Red said "something is wrong with this day" about perfectly
ordinary hours. Four other statements were made untrue by that and were corrected; the holiday name
stays red on purpose, because grey on grey loses the one word standing between a fully shaded board
and "is the software broken".

### What was verified, and how

- On `main` after both merges: fresh `npm ci` with 0 vulnerabilities, `npm run verify` green (112
  unit), `npm run test:db` green (137), `npm run test:e2e` green (90). CI green on all three jobs.
- **Against the running server on the real database.** The migration seeded exactly the seven
  values the deleted constant held. Saturday changed to 08:00-12:00 and the band moved from row 31
  to row 25 on a real board, screenshotted; a Saturday in 2017 moved with it; Karfreitag came back
  null on a Friday whose row says 09:00-18:00; the backwards range, the off-quarter time and a
  wrong PIN were refused 400, 400 and 403. Saturday was put back.
- **Every new guard mutation-tested.** A `closedBands` that keeps its own 09:00-18:00 fails both
  shading tests; deleting the holiday check fails the holiday test; reverting the review fix sends
  the refusal back off the top of the page and fails its test. The board test asks for 10:00-17:00,
  which no constant ever held.
- **The owner drove the whole thing on their own screen** and accepted it, then changed the colour.

### What was NOT verified

- **The fix commits answering the review went in unreviewed.** Roughly 110 lines written after the
  verdicts, plus the colour commit. The owner was asked directly and chose to merge - a decision,
  not an oversight. This is the fourth session running where that has been the shape of it.
- **The settings screen could not be re-checked on merged `main`**, because the PIN changed. The
  board half was verified; the hours endpoints answered 403, which is the guard working.
- **Nobody but the author and the owner has used this section**, and no second browser was pointed
  at the same database - the logic reviewer's own suggested next step, not taken.
- **Two people editing the week is last-write-wins.** No version stamp, considered and not built,
  recorded in ADR-0018 so it is not rediscovered as a bug.
- The grey wash has not been seen on a bright salon monitor, and no screen reader has heard the new
  section.

### Unfinished, and what comes next

1. **Polling**, which is now the oldest thing on this list and closes the stale-shading case for
   free. It still carries the two warnings from earlier reviews about a client holding a stale day.
2. The remaining navigation aids: date picker, month steps, arrow keys.
3. The container and the VPS, behind the brief's blocking backup gate - and the deploy where
   `COOKIE_SECURE` and `trust proxy` start to matter.
4. Two things named in the ADRs and deliberately not fixed: an appointment can still be booked
   against a deactivated stylist through the API, and guessing the PIN starves the thread pool.

### What surprised me

- **The blocker was invisible to me because I looked at the section, not at the page.** I opened the
  real screen, screenshotted it, and saw the Kernzeiten rows render correctly - with the whole page
  in view. The reviewer put six staff rows above it at 1280x720 and measured the refusal landing
  373px above the viewport. Every test passed, the live check passed, and the primary control of the
  feature gave no feedback in either direction from where a person actually stands.
- **I wrote a test that asserted the right outcome and proved half the mechanism.** "Changes nothing
  when it refuses" passes because validation runs before the first `UPDATE`, not because of the
  transaction I wrote it to cover. Caught by asking what would still pass if the transaction went.
- **A browser test can only ever prove its own fixture.** The holiday shading test looked like it
  proved the Hessen list and proved the stub instead, the moment the decision moved to the server.
  It was deleted rather than left there looking green.
- **ADR-0015 was superseded twelve hours after it was written, and its colour changed the next day.**
  The ruling survived both, because it was never about the colour.

## 2026-08-13, sixth session - the salon can manage its own staff

ADR-0018's staff and credentials halves, built and merged. **The core hours are the part that is
left**, and they are the next thing to build. Two review passes again, and the logic pass again
returned NO-SHIP on something a green suite could not see.

### Where things stand

- **`main` is at `b48719e`** and is the only branch. PR #19 merged the previous session's note;
  PR #20 merged this. Nothing in flight, working tree clean.
- **Eighteen ADRs.** ADR-0018 is now "staff and credentials built, hours not", and both it and
  ADR-0017 gained a "what building it settled" section - read those before touching either area,
  because that is where the decisions live that the original rulings did not make.
- **Both of the salon's own doors now exist**: the login screen (fifth session) and the settings
  screen behind the PIN (this one). The one thing the salon still cannot change from a screen is
  the core hours.

### What was built, and where

- **`server/staff.ts`** - the first code in this application that writes to `employee`. Read, add,
  rename, reorder, deactivate, reactivate, delete. Delete only for somebody who has never held an
  entry, which the foreign key enforces and this turns into a German sentence.
- **`/api/settings/*`** in `server/app.ts`, behind the session guard and a new PIN guard. The PIN
  travels in the `x-salon-pin` header, so one guard covers the reads too and no PIN reaches a URL.
- **`src/ui/Settings.tsx`** - the screen, reached from `Einstellungen` in the top bar, with the
  state in the address bar. Password and PIN changes sit in it, on ADR-0017's mechanism.
- `src/calendar/types.ts` gained `StaffMember` and `PIN_HEADER`, which both sides now share rather
  than each keeping their own copy.

### What the owner decided, and what I decided

- **Scope**: staff and credentials together, hours later. Asked, and answered.
- **The PIN is asked for every time the screen opens.** Asked, and answered - chosen over a
  thirty-minute unlock. It is why there is no ticket of any kind: the PIN is checked on every
  settings request and held in memory only while the screen is open.
- Mine, and recorded in ADR-0018: 403 for a wrong PIN against 401 for an ended session, renumbering
  the whole list on a move rather than swapping two rows, and locking the screen when the PIN
  changes under it.

### What was verified, and how

- On `main` after the merge: `npm run verify` green (115 unit), `npm run test:db` green (114
  against a real Postgres), `npm run test:e2e` green (83 in a browser).
- **Against a running server, not only the suite.** The whole walk through the real screen - add
  somebody, move them up, rename them, deactivate a stylist - and then the board on the way back,
  which had lost that column *and their appointments*, exactly as ADR-0012 says. Also the delete
  refusal against a stylist with real appointments, the malformed id answering 404, and the PIN
  guard answering 403 without the header and 200 with it.

### What was NOT verified

- **Nobody but me has used this screen.** Every judgement in it about what a receptionist will do
  is mine.
- **No employee row has a version stamp**, so two people renaming one stylist in the same minute is
  last-write-wins. ADR-0003 covers appointments, where the race is real; this is not that.
- The core hours are still a constant, so nothing about editing them has been tried at all.

### Unfinished, and what comes next

1. **The rest of ADR-0018: the core hours.** They move out of `src/calendar/opening.ts` into the
   database, `GET /api/day` grows a field, and `Board.tsx` draws the shading from that rather than
   computing it. The holiday half of `opening.ts` stays put - ADR-0016 - so that file ends with one
   foot on each side, and ADR-0018 already says what to do if that reads badly.
2. Polling, and the remaining navigation aids: date picker, month steps, arrow keys.
3. The container and the VPS, behind the brief's blocking backup gate. That deploy is also the day
   `COOKIE_SECURE` and `trust proxy` matter - both are written up in ADR-0017.
4. Two things named in the ADRs and deliberately not fixed: an appointment can still be booked
   against a deactivated stylist through the API, and guessing the PIN starves the thread pool that
   serves the bundle.

### What surprised me

- **I contradicted myself in one branch and did not notice.** The reordering renumbers the list
  because positions can tie - I wrote that comment myself - and the column order broke ties on the
  *name*, so renaming somebody moved their column. Two things I wrote an hour apart, each true, and
  together a bug on every day of the board.
- **A test can be written to prove a claim and still be unable to fail.** The rename test used
  positions 1 and 2. The claim it asserted was exactly the one that was broken, and it passed.
- **`FOR UPDATE` did not do what I assumed.** Under READ COMMITTED the `ORDER BY` runs on the
  snapshot from before the lock is granted, so two people pressing the arrows could lose a move.
  The comment claiming otherwise was the more dangerous half.

## 2026-08-13, fifth session - the board goes behind a password

ADR-0017 built and merged, after two review passes that between them returned one NO-SHIP and two
findings blocking a deploy. The fixes are in the same pull request. **The next session builds
ADR-0018, the settings screen**, which is also the thing that finally gives the PIN something to
guard.

### Where things stand

- **`main` is at `d4e1574`** and is the only branch. PR #17 merged the two ADRs written in the
  previous session; PR #18 merged this one. Nothing is in flight, working tree clean.
- **Eighteen ADRs**, two of them changed today: ADR-0017 is now built rather than pending, and
  ADR-0004 records that authentication closed the DNS-rebinding read its `Host` allowlist was
  aimed at - so that allowlist is no longer due, and was never written.
- **One of the two blockers on real customer names is gone.** The other stands and is untouched:
  the brief's condition is a backup that leaves the machine on a schedule and one restore that has
  actually been performed.

### What was built, and where

- **The credential row.** `migrations/004_salon_credential.sql` - one row, `CHECK (id = 1)`, an
  scrypt hash of the password, an scrypt hash of the PIN, and a version.
- **`server/credentials.ts`** owns hashing, constant-time comparison, the seed and what a usable
  password is. Nothing else reads that table. **`server/session.ts`** owns the signed cookie:
  `{version, expiresAt}`, HMAC-SHA256, base64url, thirty days, sliding on use.
- **`server/app.ts`** gained `POST /api/login`, `POST /api/credentials/reset` and a guard mounted
  on `/api` that every data route now sits behind. The static bundle stays public deliberately -
  it holds no salon data, and locking it would leave a browser nowhere to type the password.
- **`src/ui/Login.tsx`** is the screen, in German, with the master-password reset behind a link.
  `src/ui/App.tsx` shows it when a day comes back 401, which means the browser keeps no opinion
  about whether it is logged in: it asks for a day and believes the answer.
- The environment gained four required names and one optional one, and the server refuses to
  start without any of the four, naming the one it wants.

### What was decided while building, and where it is recorded

Five things the ADR left unsaid are now in ADR-0017 under "What building it settled", because
they are exactly the kind of thing a later session would re-decide by accident. The session
lifetime - thirty days, sliding - was **asked of the owner**, who chose it over a fixed month and
over a working day. The other four are mine: `COOKIE_SECURE`, the password and PIN rules living
in one place, the split attempt budgets, and hashing the master password.

### What was verified, and how

- `npm run verify` green: 115 unit tests. `npm run test:db` green: 93 against a real Postgres, 16
  of them new and all about this. `npm run test:e2e` green: 74 in a browser, 5 of them new.
- **Against a running server, not only the suite.** The seeds really are ignored after the first
  start: a second start with a different `SALON_PASSWORD` refuses that password and accepts the
  seeded one. An unauthenticated `GET /api/day` answers 401 with no customer name in the body.
  Both `COOKIE_SECURE` settings produce the cookie they claim. After the merge, a browser logged
  in through the real server and the board rendered, with `document.cookie` empty to the page.
- **The new browser test was checked by breaking the fix.** Removing the 401 line in
  `src/ui/api.ts` makes it fail, which is the only way to know a test proves anything.

### What was NOT verified, and cannot be here

- **Nobody has run this behind TLS.** `COOKIE_SECURE` is verified as far as the cookie it sets;
  the deployment it exists for does not exist yet.
- **The rate limiter behind a reverse proxy is reasoned, not observed.** There is no proxy here.
  When one arrives, `trust proxy` must be set to the specific hop - `true` makes
  `X-Forwarded-For` whatever the caller says and removes the limit entirely.
- **The PIN is stored and can be reset, and nothing checks it.** Deliberate: there is no screen
  behind it until ADR-0018.
- Nobody has used any of this except me. No stylist has typed the password on their own machine.

### Unfinished, and what comes next

1. **ADR-0018, the settings screen.** Staff first, hours second. It brings the PIN check with it.
2. Polling, and the remaining navigation aids.
3. The container and the VPS, behind the brief's blocking backup gate - and that is also the
   deploy that makes `COOKIE_SECURE` matter.

### What surprised me

- **Both review passes found things a fully green suite could not see, again.** The blocker was a
  401 arriving at a *write*: the read path handled it and the write path turned it into a
  field-validation error inside a dialogue whose own backdrop swallowed every click that could
  escape it. Every test passed while that was true.
- **My own comment was the wrong claim.** I wrote that deriving `Secure` from the bind address
  "fails closed and visibly". It does, for a direct public bind - and not for the commonest
  deployment there is, a proxy terminating TLS in front of a loopback bind, which from inside the
  process is indistinguishable from stage one. The security pass named it in one paragraph.
- **Hashing the master password was not obvious until it was measured.** A constant-time SHA-256
  comparison is correct and looks careful, and it is 27,000 times cheaper to guess than the
  credential it can overwrite.

## 2026-08-13, fourth session - an interview, and no code at all

**Nothing was built. That is the point of this entry.** The owner asked for a settings screen,
the interview turned it over four times, and the result is two ADRs and a brief. The next
session builds it, and should read ADR-0017 and ADR-0018 before anything else.

### Where things stand

- **`main` is at `3f72097`** and this branch, `docs/settings-and-auth-brief`, adds documentation
  only: `ADR-0017`, `ADR-0018`, pointers on `ADR-0004` and `ADR-0015`, a paragraph in the product
  brief, the README table, and this entry.
- **Eighteen ADRs.** The two new ones are marked **not yet implemented**, which is a status this
  log has not had before - read them as instructions, not as descriptions.
- No code changed, so nothing to verify beyond the checks still being green.

### What was decided, in the order it was asked

The owner brought two open questions - does the admin screen need its own password, and does it
come before or after authentication - and the interview answered both, then rewrote itself twice:

1. **Authentication first**, and the salon password moves out of the environment into the
   database as a hash so the screen can change it. That supersedes half of ADR-0004, which had
   marked itself to be revisited before authentication was written. This is that revisit.
2. **An email reset was proposed and withdrawn.** The owner's first answer was a reset by email
   plus confirmation mails; when the cost was laid out - a provider, an API key, a from-domain, an
   unauthenticated endpoint to rate-limit, and a reset link that in stage one points at
   `127.0.0.1` - they replaced it with a master password in the environment. That exchange is the
   most valuable thing in the interview and it is recorded in ADR-0017's rejected alternatives.
3. **A four-digit PIN guards the settings screen**, not a re-entered password, and with no
   lockout. Ten thousand guesses from a logged-in console is minutes, the owner was told so
   plainly, and accepted it: everybody who can reach the prompt already sees every customer name.
   The PIN separates using the board from changing it, nothing more.
4. **Changing the password logs everybody out.** The owner corrected my assumption here, and the
   reason is the reason passwords get changed: somebody left. It needs a credential version in the
   session, not just a signed cookie.
5. **Delete a stylist only if they never held an appointment**, which the foreign key already
   enforces; everybody else is deactivated. A narrow amendment to ADR-0002 for the case it did not
   have in mind - a name typed wrong.
6. **Core hours move into the database**, superseding ADR-0015's own "not configuration"
   paragraph, which had named the condition under which it would stop being true. The hours get no
   history: editing Saturday re-shades every Saturday, and the owner accepted that because the
   colour is for recognising where appointments normally go, not for keeping a record.

### What was verified, and how

- `npm run verify` on this branch: green, 97 unit tests, and `main` is unchanged underneath.
- Nothing else. **There is no code in this branch**, so any claim about behaviour would be a
  claim about something that does not exist yet.

### What was NOT verified, and cannot be

- **Every word of ADR-0017 and ADR-0018 is a design, not an observation.** `scrypt` from
  `node:crypto` is named as the hash because it needs no dependency; nobody has run it here. The
  credential-version mechanism for logging everybody out is one sentence of prose, not a schema.
- **The interview's own assumptions are untested**: that four digits is enough friction for a
  six-person salon, that nobody will need per-person accounts, and that a master password in an
  environment variable will actually be findable on the day it is needed.

### Unfinished, and what comes next

1. **Build ADR-0017**: the credential row, the seeds, the startup refusal, the session with a
   credential version, the login screen, the master-password reset screen. Authentication is the
   gate before any real customer name, and ADR-0004's deadline has not moved.
2. **Then ADR-0018**: the settings screen. Staff first, hours second - the hours drag `opening.ts`
   half into the database and `GET /api/day` grows a field, so it is the part most likely to want
   its own interview once the staff half is real.
3. Polling and the remaining navigation aids still sit behind both.
4. The container and the VPS, with the blocking backup gate in the brief.

### What surprised me

- **The email reset died of its own cost estimate, not of an argument.** Laying out what it needed
  was enough; nobody had to be talked out of anything, and the design that replaced it is smaller
  than the one that started the conversation.
- **The PIN arrived in round three and changed the shape of round four.** An interview that had
  settled "re-enter the password" produced a better answer once the owner said what they actually
  wanted, which is that it should be *convenient*. Convenience was never in any of my options.
- **ADR-0015 predicted its own supersession by two hours.** It said the hours become configuration
  the day somebody wants to change them without a release; that day was the same afternoon.

## 2026-08-13, third session - five small changes, all merged

Written after everything landed. The entry below describes the same day up to the merges; this one
carries the state.

### Where things stand

- **`main` is at `8912e78`**, and `main` is the only branch that exists. PR #15 merged block
  reasons, core-hours shading, Hessen holidays, the holiday name in the top bar, the `N/A` marker,
  and the previous entry.
- **Sixteen ADRs.** ADR-0014 (a block may say why) supersedes part of ADR-0008; ADR-0015 (core
  hours shade and refuse nothing); ADR-0016 (Hessen holidays as a list) supersedes ADR-0015's
  refusal to have one. ADR-0011 gained its first exception, recorded in both places: the board says
  `N/A`, not `Gesperrt`.
- **Nothing is in flight.** No open pull request, no stale branch, working tree clean.

### What was built, and where

- **A block may carry an optional reason.** `migrations/003_block_reason.sql` adds the column and
  replaces `appointment_fields_match_kind`; threaded through `server/write.ts`, `server/day.ts`,
  `src/calendar/types.ts`, `src/ui/api.ts`; `Grund` field in `src/ui/EntryModal.tsx`; drawn by
  `src/ui/EntryBox.tsx`; carried through a drag by `src/ui/App.tsx`.
  - Its own column and not `notes`, because notes are private and never drawn - one column with two
    visibility rules is how the hidden one gets shown by accident.
  - The box reads `N/A Urlaub`, or `N/A` bare. The owner changed this twice: first the reason
    replaced `Gesperrt`, then the marker became `N/A` with the reason behind it.
- **The salon's core hours and Hessen's holidays shade the board.** `src/calendar/opening.ts` holds
  both as constants; `closedBands` in `src/ui/Board.tsx` draws them; `.board__closed` in
  `src/styles.css` is the wash; `src/ui/TopBar.tsx` names the holiday.
  - Shading only. The bookable window is still 06:00-20:00 every day, and a browser test clicks a
    closed hour and expects the form.
  - Fifty holiday dates through 2030, from `feiertage-api.de` with `nur_land=HE`, cross-checked
    against the Easter arithmetic before being written down.

### What was verified, and how

Run on `main` at `8912e78`, after the merge:

- `npm run verify` green: 97 unit tests, lint, typecheck, build.
- `npx playwright test`: 69 passed. `npm run test:db`: 75 passed against Postgres 17.
- `npm audit --audit-level=high`: 0 vulnerabilities. CI green on the branch before merging.
- **Driven on the running board** for a Thursday, a Saturday, a Sunday, Karfreitag and Fronleichnam:
  the bands land where the hours say, and the top bar reads `KW 14 · Karfreitag · Stand 17:38`.
- **A labelled block dragged on real data:** `16:00` to `16:30`, and Postgres shows
  `16:30 | 16:45 | Zahnarzt | version 2`. The reason survived the write.
- **Every new guard was mutation-tested**: the shading's `pointer-events`, the `aria-label`, the
  short-box label, the untick guard, the drag carrying a reason, the holiday wiring, and the expiry
  tripwire faked forward to 2026.
- **The owner checked the wash and the `N/A` label on their own screen** and accepted both, saying a
  too-bright colour is an easy fix afterwards.

### What was NOT verified

- **Two commits merged unread.** Both review passes read `28cf485..8e95cc0`; `c5c0425` and
  `b4df011` answer them and nobody else has read those. The pull request said so with the box
  unticked, and the owner merged anyway - a decision, not an oversight.
- **No screen reader has heard the `aria-label`.** It is asserted by a test and judged by nobody.
  The owner's check was visual.
- **`CORE_HOURS` is a constant**, so the shading is wrong the day the salon's hours change and
  nobody edits it. There is no mechanism that would notice.
- **The holiday list was checked against the Easter arithmetic and its own internal consistency, not
  against a second source.** It ends on 2030-12-31 and a unit test fails from 2029-12-31 onward with
  the refresh recipe in its message.
- **Changing an entry's kind drops the other kind's text on save**, with nothing on screen at that
  moment showing what is about to go. Accepted and recorded in ADR-0014.
- **A lost `pointerup` would leave a box glued to the pointer.** `Board.tsx` does not check
  `event.buttons`; a reviewer inferred it and could not reproduce it, and nothing defends against it.
- **Nothing has run from a clean `docker compose up` on a machine that has never run this**, which
  is in the brief's "done when". The compose file still has no application service.
- The wash is 2 to 15 RGB units of difference and has not been seen on a bright salon monitor.

### Unfinished, and what comes next

1. **Authentication.** ADR-0004, marked to be revisited before a line of it is written, and the gate
   before any real customer name.
2. **Polling**, carrying two warnings from earlier reviews: a client holding a day loaded before a
   deactivation keeps offering to edit entries the server no longer sends and `updateEntry` will
   accept that write by id; and an update landing mid-drag is the brief's own awkward case.
3. The remaining navigation aids: date picker, month steps, arrow keys.
4. The application container and the VPS, with the blocking backup gate in the brief.
5. Housekeeping: the dev database carries two block reasons and one 15-minute block from testing,
   and the owner has been editing that data too, so its contents are nobody's record of anything.

### What surprised me

- **Both review blockers were sentences I had written in bold, in ADRs, an hour earlier.** The code
  was right more often than the prose about it, which is the opposite of what I would have guessed
  and an argument for reviewing documents as code.
- **A gesture that was safe by construction stopped being safe because a neighbouring feature gave
  blocks text.** Nothing about the whole-day tick changed; the reason it needed no confirmation
  simply stopped being true, and only a review pass noticed.
- **The first live drag I tried after merging was refused** by the clash guard, because I dropped it
  onto a real booking. Accidental proof on real data, and a reminder that a check reads better when
  you did not arrange for it to fire.
- **A hardcoded list expires invisibly**, so the expiry test reads the clock on purpose - the only
  test in the project that does, and the only mechanism that will notice.

## 2026-08-13, second session - four review passes, dragging, a reversed ruling, four small changes

Everything below still applies except where this entry contradicts it - and it contradicts the
next entry's opening claims, because that session's asks have now been done.

### Where things stand

- **`main` is at `28cf485`.** Three pull requests merged during this session, in this order: #12
  (the write-path fixes), #14 (dragging), #13 (ADR-0012). All three branches are deleted.
- **Four more changes are on `feat/block-reason`, unmerged and unpushed**, on top of the three
  documentation commits that produced this entry: block reasons (`e619817`), core-hours shading
  (`d2662b9`), Hessen holidays (`d4662fe`), the holiday name in the top bar (`8e95cc0`), and the
  fixes answering the review of all four. The branch name stopped describing its contents after the
  first one.
- **Sixteen ADRs.** ADR-0012 supersedes the visibility half of ADR-0002; ADR-0013 records what a
  drag means; ADR-0014 lets a block say why and supersedes part of ADR-0008; ADR-0015 shades the
  salon's core hours and refuses nothing; ADR-0016 makes Hessen's holidays a hardcoded list and
  supersedes ADR-0015's refusal to have one.
- **Nothing is on a pull request.** Everything above needs one, and this file is on the same
  branch as the code it describes.
- **The write path was finally read by somebody who did not write it** - the previous entry's
  one blocking ask. Both passes ran over `620164c`, and what they found is below.

### The four small changes, and what the review of them found

Asked for one at a time after the merges, each interviewed only as far as it needed:

- **A block may carry a reason** (`ADR-0014`), drawn on the grey box in place of `Gesperrt`. Its own
  column rather than `notes`, because notes are private and deliberately never drawn - one column
  with two visibility rules is how the hidden one gets shown by accident.
- **The salon's core hours shade the board** (`ADR-0015`): Tue-Fri 09:00-18:00 and Sat 08:00-13:30
  stay white, everything else and all of Sunday and Monday is washed light red. Shading only. The
  bookable window is still 06:00-20:00 every day, and a test clicks a closed hour to prove it.
- **Hessen's public holidays** (`ADR-0016`), fifty dates through 2030 hardcoded from
  `feiertage-api.de` and checked against the Easter arithmetic, with the name in the top bar. The
  list expires with a failing test a year before it runs out, which is the only mechanism that
  would notice.

Both passes read `28cf485..8e95cc0`. Security said SHIP after running an `<img onerror>` and a
`DROP TABLE` through the new field, proving the migration holds an exclusive lock so its
drop-and-recreate has no window, and grepping the built bundle to confirm the holiday URL is
tree-shaken out. Logic said NO-SHIP for two, and both were mine:

1. **The accessible name did not say `gesperrt`** once a reason replaced the word - `title` is only
   consulted when an element has no text content, and this button has plenty. A screen reader heard
   "14:00 bis 15:00 Urlaub", indistinguishable from an appointment for a customer called Urlaub. I
   had claimed the opposite in a code comment and in bold in ADR-0014. Fixed with an `aria-label`.
2. **This entry contradicted its own branch**, saying thirteen ADRs and nothing open while the
   branch carried sixteen and four unreviewed features. Fixed above.

Three more, all fixed rather than argued: unticking a labelled whole-day block deleted typed text
on one click with no confirmation, so it now opens the form instead; a 15-minute block drew its
reason nowhere at all, so it shares one line with the start time; and changing an entry's kind
drops the other kind's text on save, which is accepted and now recorded in ADR-0014 rather than
left to be rediscovered.

### What was built, and where

- **#12, the two blockers from the write-path review.** `App.tsx` captures the day into
  `editor` when the form opens, so a day arriving underneath cannot take the save with it.
  `EntryModal.tsx` no longer hands the keyboard the `Sperrzeit` checkbox. The dimmed board is
  `inert` while a day loads.
- **#14, dragging.** `src/ui/gesture.ts` is new and pure: the slot arithmetic for move, resize
  and create, with its own unit tests. `Board.tsx` holds the pointer handlers and one gesture
  at a time; `EntryBox.tsx` gained resize grips and draws itself at the dragged position;
  `grid.ts` gained `rangeFromSlots`, `whyNotFree` and `TIME_TAKEN`; `App.tsx` gained `dragged`.
- **#13, ADR-0012.** `server/day.ts` returns active employees only and joins entries to
  `employee.active`, so a hidden column cannot produce an orphaned entry. Docs, the schema
  comment and one rewritten database test came with it.

### What four review passes found, all of it real

Five blockers between them, every one reproduced by the reviewer rather than argued:

1. **A drag in flight wrote to whatever day arrived.** I had declined to defend this, on the
   grounds that navigating mid-drag needed a hand that could not exist. Wrong: a mouse's back
   side-button does it, and so does Alt with Left.
2. **The drag threshold was not a threshold.** It compared slots, and a row is 17.6px, so a
   three-pixel twitch across a row line saved a fifteen-minute change from about a third of
   every box. The test that covered it passed by luck - the box centre it grabbed sat exactly
   on a row boundary.
3. **`pointer-events: none` was mouse-only.** Tab into the dimmed board, press Space, and the
   whole day that was leaving got blocked: the exact bug that fix was written to close.
4. **ADR-0012 claimed in bold that a hidden employee's entries "do not leave the server".**
   They do: `/api/suggestions` has no `active` predicate, so a customer only a leaver served is
   still offered in the form. The behaviour is right and is now recorded as deliberate - a
   customer belongs to the salon - and the sentence was wrong.
5. **`migrations/001_init.sql` still asserted the rule ADR-0012 reverses**, two lines from the
   flag the whole change turns on, in the file a new reader opens first.

Also: a proposal painted red then opened the form as if it would be accepted; focus landed on
the Person select, where one ArrowDown reassigns the stylist on Windows and Linux; and a
`whyNotBookable` call that could never return non-null.

### What was verified, and how

Run on `main` at `28cf485`:

- `npm run verify` green: 83 unit tests, lint, typecheck, build.
- `npx playwright test`: 56 passed. `npm run test:db`: 68 passed against Postgres 17.
- `npm audit --audit-level=high`: 0 vulnerabilities. CI green on both rebased branches before
  each merge.
- **Real drags against the real database, through the built server.** A move wrote through
  (`version` 2 to 3), a move onto a neighbouring booking was refused with the clash sentence
  and sent nothing, and dragging it back wrote again (version 4). A three-pixel twitch beside a
  row line opened the form and wrote nothing.
- **ADR-0012 driven live**, which no browser had done: Marco deactivated in the dev database,
  reload, and his column and all six of his appointments are gone with no undrawn report -
  the server filtered them. Colours visibly shifted. Typing "Anna" still offered his customer.
  Reactivated afterwards; the board is back to six columns and 24 entries.
- **Every new guard was mutation-tested**: the threshold, `inert`, the captured day, the
  undrawn report and the client refusal each confirmed to fail with its own mechanism broken.
- **The owner drove the board and found nothing wrong.** Their words, and worth having - it is
  also one person, on one screen, with fake data.

### What was NOT verified

- **The fix commits went in unreviewed.** Roughly 500 lines written *after* the verdicts, and
  answering them, are in `main` with no independent reader. Each round so far found real
  blockers in exactly that kind of code. **The owner accepted this on 2026-08-13** rather than
  run the passes again: a decision, not an oversight, and it is not an open task. It stays
  written down because it is worth knowing when something surfaces in `daabbbb..28cf485` -
  those three merges are the code nobody but its author has read.
- **Two of my own verifications proved nothing until caught.** A leftover Vite dev server on
  4173 served another working tree, so a "worktree" browser run tested the wrong code; and my
  first keyboard test for `inert` passed with `inert` removed, because a fixed number of Tab
  presses never reached the board.
- No keyboard or screen reader pass over dragging - there is deliberately no gesture for them,
  which ADR-0013 records rather than fixes. No touch. No Windows or Linux: the Person-select
  ArrowDown finding was inferred by a reviewer, not reproduced.
- **A lost `pointerup` would leave a box glued to the pointer** (`Board.tsx` does not check
  `event.buttons`). A reviewer inferred it and could not reproduce it; nothing defends against
  it, on purpose.
- **No framing protection anywhere.** No `X-Frame-Options`, no CSP `frame-ancestors`, and there
  are now two no-confirmation mutation paths behind that gap. Pre-existing, and not this
  session's doing.

### Unfinished, and what comes next

1. **Authentication.** ADR-0004, still marked to be revisited before a line of it is written,
   and still blocking before any real customer name.
2. **Polling**, with two warnings from this session's reviews: a client holding a day loaded
   before a deactivation keeps offering to edit entries the server no longer sends, and
   `updateEntry` will accept that write by id; and an update landing mid-drag is the case the
   brief already flags.
3. The remaining navigation aids, then the application container and the VPS, with the
   blocking backup gate in the brief.

### What surprised me

- **The scenario I dismissed as invented was reachable with a mouse button.** Gate 1 says do
  not defend an invented scenario; the judgement about what is invented is the hard part, and I
  got it wrong on a write that loses an appointment.
- **A passing test can be luck.** Nothing about that test looked wrong; the geometry underneath
  it happened to be kind.
- **The previous session's own work log entry never landed.** It was committed locally, the
  pull request had squash-merged an earlier state of the branch, and `--delete-branch` took the
  local copy with it. This session recovered the commit and it is in this branch. The note
  written to protect the next session was the thing that got lost, and nothing noticed for a
  day.
- **A stray dev server can invalidate a whole test run silently.** `reuseExistingServer` did
  exactly what it says, and the tests were green against code that was not the code under test.

## 2026-08-13 - the write path, and the form

The board can now be edited. Everything below the entry for 2026-08-12 still applies except
where this entry contradicts it.

### Where things stand

- **`main` is at `620164c`.** Schema, `GET /api/day`, the board, the write path, the form,
  eleven ADRs, the brief and the README.
- **PR #11 is open and carries this file** plus a note on ADR-0002. Nothing else is
  outstanding. Merging it costs nothing and is the tidiest first move tomorrow.
- **The write path merged as PR #10, with no review pass having read a line of it**, by the
  owner's decision. This is the second time that has happened and it matters more than the
  first: the board could only display things wrongly, and this branch can lose a real
  appointment. `src/ui/App.tsx`, `src/ui/EntryModal.tsx` and `server/write.ts` have been read
  by nobody but the agent that wrote them. **Run `reviewer` and `security-reviewer` over
  `620164c` before anything else lands on top of them.**

### What was built, and where

- `migrations/002_appointment_version.sql` - the `version` column, added while the table is
  empty, which is the only moment a `NOT NULL` column costs nothing.
- `server/write.ts` - create, change, remove. Every refusal is a German sentence naming one
  rule, plus a machine-readable code (`invalid`, `clash`, `stale`, `gone`).
- `server/suggestions.ts` - autocomplete over a rolling year. An empty query returns nothing,
  because an empty prefix would return the salon's whole customer list in one request.
- `src/ui/EntryModal.tsx` - the form. Person, times, customer, treatment, notes, a `Sperrzeit`
  checkbox, and delete behind a confirmation.
- `src/calendar/grid.ts` gains `whyNotBookable`, used by the browser before saving and by the
  server regardless - the same function, because two copies would agree today.
- `tests/write.db.test.ts`, `tests/modal.browser.test.ts`.

### What was verified, and how

Run on `main` at `620164c`:

- `npm run verify` - green.
- `npm run test` - 62 passed.
- `export $(grep TEST_DATABASE_URL .env) && npm run test:db` - 65 passed against real Postgres.
- `npm run test:e2e` - 38 passed in Chromium.
- `npm audit --audit-level=high` - 0 vulnerabilities.
- The API was driven by hand: a clash, a zero-length drag and a stale version each came back
  with their own sentence and status.
- The owner drove the running board in their own browser.

### What was NOT verified

- **No review pass has read the write path.** See above. This is the largest gap in the project.
- **Nothing has exercised two people editing at once through the interface.** The stale-version
  tests are sequential, which is the mechanism and not the race.
- **`removeEntry` is not inside `guarded`** in `server/write.ts`, so an unreachable constraint
  failure on delete would surface as a 500 rather than a sentence. Nothing references an
  appointment, so I believe it is unreachable, and that belief is untested.
- **The board is writable and unauthenticated.** Loopback still holds and the names are fake, so
  ADR-0004's deadline has not moved - but anyone who can reach the port can now change data.
- No keyboard-only pass over the form, and no screen reader has seen the dialogue.

### Unfinished, and what comes next

1. **Review `620164c`** before building on it.
2. **Dragging**: out of empty grid to create a range, a box to another time or stylist, an edge
   to resize. The brief's spring-back-with-a-reason belongs here, and the server refusals it
   needs already exist and are tested.
3. Authentication, then polling, then the remaining navigation aids.
4. The application container and the VPS, with the blocking backup gate in the brief.

### What surprised me

- **The owner found two defects that 165 passing tests did not.** The delete confirmation made
  the actions row wider than the dialogue and pushed `Speichern` off the edge; and the colour
  legend was unwanted. Both were invisible to the suite because no test measures whether things
  fit.
- **Fixing the first one created a worse one.** Hiding the other buttons put `Ja, löschen`
  exactly where `Speichern` sits on every other view, so a hand that had learned that corner
  would hit the one action with no undo. The safe answer now holds that position.
- **A Playwright glob silently disabled four tests.** `**/api/entries*` never matches
  `/api/entries/a1`, because `*` stops at a slash - so no PATCH or DELETE was intercepted and
  those tests passed on requests that went nowhere.
- **A feature request needed no code.** "Let me toggle which columns are visible" turned out to
  be answered by the `active` flag that already exists. Recorded in ADR-0002 so the next person
  does not build it.

## 2026-08-12 - interview, schema, API, board

First working session on this project. It started as an empty workflow template and now has
a database, an API and a read-only board.

### Where things stand

- `main` was at `f6ec955` when this entry was written. See the entry above for where it is now.
- **The board merged as PR #8.**
- **It went through three review rounds.** Round two: logic NO-SHIP, security SHIP, UX (which
  does not vote) found more than the other two together. Round three, after those fixes:
  security SHIP, logic NO-SHIP again, UX found three regressions the fixes had introduced.
- **The final fix commit merged without a review pass, by the owner's decision.** Both passes
  read the commit before it; nothing read the regression fixes themselves. That was a choice,
  not an oversight: the board is read-only, cannot change any data, and no real customer name
  can reach it. The reasoning stops holding the moment the write path exists, so **the write
  branch inherits the job of looking at this code too** - particularly `src/ui/App.tsx`, where
  every defect of the last two rounds lived.

### What was built, and where

- `migrations/001_init.sql` - `employee` and `appointment`. One table holds appointments and
  blocks, because a Postgres exclusion constraint cannot span two tables and "nothing may be
  booked over a block" is exactly what it has to enforce.
- `server/` - `config.ts`, `migrate.ts`, `day.ts`, `app.ts` (HTTP surface), `index.ts`
  (startup). One route: `GET /api/day`.
- `src/calendar/` - `types.ts`, `colours.ts`, `salon-date.ts`, `dates.ts`, `grid.ts`. Pure,
  no imports, shared by the server and the browser.
- `src/ui/` - `App.tsx`, `TopBar.tsx`, `Board.tsx`, `EntryBox.tsx`, `api.ts`.
- `docker-compose.yml` - Postgres only. The application service is not there yet.

### What was verified, and how

Run on `main` at `f6ec955`, after the merge:

- `npm run verify` - green (typecheck, lint, 55 unit tests, build).
- `npm run test` - 55 passed.
- `export $(grep TEST_DATABASE_URL .env) && npm run test:db` - 41 passed against a real
  Postgres 17 container.
- `npm run test:e2e` - 25 passed in Chromium.
- `npm audit --audit-level=high` - 0 vulnerabilities, run earlier in the session.
- CI green on all three jobs for every commit that merged.
- The board was driven by hand against a seeded database and screenshotted at 1440x1000 and
  1280x800, scrolled and unscrolled.

### What was NOT verified

**Read this section before believing anything above.**

- **The owner has now seen the board** on a 1280x720 screen with six columns and called it
  good. That closes "nobody has looked at it" for the read-only board, and closes nothing
  else: the wording, and whether the gestures land where a hand expects them, are still
  unjudged, and there are no gestures yet to judge.
- ~~Six columns on a 1280px laptop has never been rendered.~~ **Closed.** Seeded with six
  stylists and 25 entries and looked at by the owner on a 1280x720 screen: the layout holds,
  and the extra scrolling was expected. This was the brief's own awkward case and it is no
  longer open.
- **ADR-0007's daylight-saving reasoning is still unread.** It claims EU transitions fall at
  01:00 UTC, outside the 06:00-20:00 window, so no bookable time is ambiguous. Nobody has
  checked that against the salon's actual timezone.
- ~~No write path exists.~~ Built on 2026-08-13; see the entry above.
- **No authentication exists.** The server is private only because it binds to loopback.
- **Nothing polls.** The board shows a day loaded once and looks equally trustworthy nine
  hours later, which is the exact failure the brief says the salon has with photographs.
- No screen reader pass, no keyboard-only pass, and the palette is unverified for colour
  vision deficiency.

### Unfinished, and what comes next

1. ~~The write path.~~ Built on 2026-08-13, except the dragging.
2. **Authentication before any real customer name.** ADR-0004 is marked to be revisited
   first, and its deadline is whichever comes first: the first real name, or the first bind
   that is not loopback. A deploy is the quiet act that ends loopback protection.
3. Polling, then the remaining navigation aids (date picker, month steps, arrow keys).
4. The application container and the VPS, with the blocking backup gate in the brief.
5. Housekeeping: `feat/blocks-and-colours` still exists locally and on the remote. It is an
   orphan from a stacked-pull-request mistake; its content reached `main` through PR #5, so it
   is safe to delete. Left alone because deleting a remote branch was not asked for.

### Open questions for the owner

- `Gesperrt` was questioned by the UX review, which suggested `Nicht verfügbar`. Kept because
  the owner had already approved that word in a preview. Their call.
- No current-time line. Raised by the UX review, which judged it can wait: the person always
  knows what time it is, and it needs the same clock-in-the-client that polling needs.
- The board now says `Stand HH:MM` with an `Aktualisieren` button. That was built because
  nothing polls yet, so a board loaded at 09:00 was indistinguishable from a live one at
  14:00 - the exact failure the brief says the salon already has with photographs. It is a
  stopgap, not the live board the brief promises.
- The palette is ten colours, so a day with more than ten distinct customers reuses one. The
  owner accepted this knowing the number.

### What surprised me

- **A test asserted the defect it was named for, twice.** Once for the colour ordering rule,
  once for "notes stay hidden until clicked" - the second passed while a tooltip revealed the
  notes on hover. A green suite says nothing about a behaviour asserted the wrong way round.
- **Two defects came from opening a screenshot**, not from tests: a marker rendering in the
  wrong column, and a 15-minute box showing a time with no customer name.
- **The interesting bugs needed latency to appear.** Three quick clicks of "next day" under
  700 ms produced two requests and three identical history entries. Locally it is 5 ms.
- **`CREATE TABLE IF NOT EXISTS` is not safe against a concurrent creator.** Two processes
  migrating one empty database produced a duplicate-key error on `pg_type`.
- **Reasoning about the overlap constraint would not have found its hole.** Running it did: an
  empty range overlaps nothing, so a zero-length row was accepted inside an occupied hour.
- Three independent review passes found the same tooltip bug. Two of them found the JSON-404
  contract wart. Running more than one was not redundant.
- **Fixes introduced defects of the same family they closed, twice.** Un-disabling `Heute`
  turned a button that looked wrong into one that looked alive and did nothing, because
  setting state to a value it already holds does not re-run an effect. And making the address
  bar agree with the board on failure left it disagreeing after a successful retry - silently,
  where before it had at least been announced. A fix is a change, and a change needs the same
  suspicion as the code it replaces.
- **A search-and-replace on CSS matched a selector as a substring** and deleted
  `display: grid` from a combined rule, which collapsed the whole board. Every test still
  passed. The screenshot is the only thing that caught it.

### Local environment notes

- `.env` exists and is gitignored, with a password generated during this session. It is not
  written down anywhere else; regenerate it and recreate the container if it is lost.
- Postgres runs via `npm run db:up` and was left running. Docker Desktop was started during
  this session.
- Vitest does not read `.env`, so database tests need
  `export $(grep TEST_DATABASE_URL .env)` first.
- The browser tests stub the API and need no database.
