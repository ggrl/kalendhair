# Work log

Newest first. Read the top entry before doing anything.

## 2026-08-12 - interview, schema, API, board

First working session on this project. It started as an empty workflow template and now has
a database, an API and a read-only board.

### Where things stand

- `main` is at `80933c6`. It has the schema, `GET /api/day`, eleven ADRs, the brief and a
  rewritten README.
- **`feat/read-only-board` holds the board, open as PR #8. It is NOT merged.**
- **The board went through three review rounds.** Round two: logic NO-SHIP, security SHIP,
  UX (which does not vote) found more than the other two together. Round three, after those
  fixes: security SHIP, logic NO-SHIP again, UX found three regressions the fixes had
  introduced. All of round three is fixed, and **that fix has not itself been reviewed** -
  re-run all three passes before merging.

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

Run at the end of the session, on `ac09eaa`:

- `npm run verify` - green (typecheck, lint, 51 unit tests, build).
- `export $(grep TEST_DATABASE_URL .env) && npm run test:db` - 41 passed against a real
  Postgres 17 container.
- `npm run test:e2e` - 22 passed in Chromium.
- `npm audit --audit-level=high` - 0 vulnerabilities.
- CI green on all three jobs for `ac09eaa`.
- The board was driven by hand against a seeded database and screenshotted at 1440x1000 and
  1280x800, scrolled and unscrolled.

### What was NOT verified

**Read this section before believing anything above.**

- **No human has looked at this application.** Every screenshot was read by an agent. The
  wording, the legibility and whether the day steps are where a hand expects them are
  unjudged by anybody who will use it.
- **Six columns on a 1280px laptop has never been rendered.** Every screenshot had four. The
  brief lists it as an awkward case.
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

1. Get the two outstanding re-review verdicts on PR #8 and merge it.
2. **The write path**: create, drag to move, edge-drag to resize, the modal, the two
   checkboxes for blocks. This needs a `version` column (ADR-0003) - the table is empty, so
   that is free right now and a migration with a backfill later.
3. **Authentication before any real customer name.** ADR-0004 is marked to be revisited
   first, and its deadline is whichever comes first: the first real name, or the first bind
   that is not loopback. A deploy is the quiet act that ends loopback protection.
4. Polling, then the remaining navigation aids (date picker, month steps, arrow keys).
5. The application container and the VPS, with the blocking backup gate in the brief.

### Open questions for the owner

- `Gesperrt` was questioned by the UX review, which suggested `Nicht verfügbar`. Kept because
  the owner had already approved that word in a preview. Their call.
- No current-time line and no freshness indicator on the board. Both were raised; polling is
  a later branch by decision.
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
