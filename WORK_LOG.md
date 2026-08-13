# Work log

Newest first. Read the top entry before doing anything.

## 2026-08-12 - interview, schema, API, board

First working session on this project. It started as an empty workflow template and now has
a database, an API and a read-only board.

### Where things stand

- **`main` is at `f6ec955`.** It has the schema, `GET /api/day`, the board, eleven ADRs, the
  brief and a rewritten README.
- **PR #9 is open and carries this file.** It is the only thing outstanding, it changes nothing
  but the work log, and CI is green on it. If you are reading this on `main`, it merged; if you
  are reading it on a branch, it did not, and merging it costs nothing.
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
- **No write path exists**, so nothing has exercised: turning a constraint violation into a
  sentence a receptionist can read, the stale-save refusal in ADR-0003, or the version stamp
  that ADR does not yet have a column for.
- **No authentication exists.** The server is private only because it binds to loopback.
- **Nothing polls.** The board shows a day loaded once and looks equally trustworthy nine
  hours later, which is the exact failure the brief says the salon has with photographs.
- No screen reader pass, no keyboard-only pass, and the palette is unverified for colour
  vision deficiency.

### Unfinished, and what comes next

1. **The write path**: create, drag to move, edge-drag to resize, the modal, the two
   checkboxes for blocks. This needs a `version` column (ADR-0003) - the table is empty, so
   that is free right now and a migration with a backfill later. It also inherits the review
   the last board commit did not get.
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
