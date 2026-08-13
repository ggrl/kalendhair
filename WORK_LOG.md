# Work log

Newest first. Read the top entry before doing anything.

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
