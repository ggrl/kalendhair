# Salon appointment board

A single-day appointment board for a hair salon. One page per day, one column per
employee, 06:00 to 20:00 down the side in 15-minute steps.

## The problem it exists to solve

The salon runs the day on paper. When somebody else needs to see it, they photograph the
page and send the picture. Calendar products were tried and rejected as not flexible
enough.

So the failure is not scheduling - paper does that well. It is that **a photograph is a
dead copy the moment it is sent**, and nobody holding one can tell how stale it is.

That is why this is deliberately close to the paper page, why the customer and treatment
fields are free text with no list to maintain, and why there are no fixed slots. The
product they rejected was the one that made them work its way.

Full statement of intent: [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md).

## What works today

Being built in stages, smallest useful piece first, each one reviewed before the next.

| | Status |
| --- | --- |
| Database schema, with the no-overlap rule enforced by Postgres | done |
| `GET /api/day` - one day of columns and boxes, with colours assigned | done |
| The board: 06:00-20:00 grid, a column per employee, coloured boxes, grey blocks, notes on click | done |
| The salon's core hours and Hessen's holidays shaded on the board, refusing nothing | done |
| Navigation: day steps, week steps, `Heute`, the `KW` number, date in the address bar | done |
| Navigation: date picker, month steps, arrow keys | not started |
| Live updates, by polling the day on screen | not started |
| Creating and editing appointments in a form, with autocomplete | done |
| Moving and resizing by dragging, with a form for the details | done |
| Authentication: one shared password, a session that a password change ends, and a master-password reset | done |
| A settings screen for staff, hours and credentials, behind the PIN | not started - designed in ADR-0018 |

The screen is German. Code, comments and these documents are English - they are for whoever
maintains it, not for the salon.

**Still not ready for a real customer name, and now for a different reason.** The board is
behind a password as of 2026-08-13, which was one of the two blockers. The other stands: there
are no backups, and `docs/PRODUCT_BRIEF.md` makes one tested restore the condition for putting
real data in. The server still binds to loopback and there is still no TLS, so stage one runs
on fake names only.

## Requirements

- [Node.js](https://nodejs.org) 22.12 or newer. With `nvm`, run `nvm use` and it takes the
  version from `.nvmrc`.
- [Docker](https://docs.docker.com/get-docker/), for Postgres.

## Running it

```bash
npm ci
cp .env.example .env
```

Open `.env` and fill in every empty value. There are no defaults: a committed placeholder is
the thing people forget to change, and `rules/secrets.md` forbids one anyway. `.env` is
gitignored.

- `POSTGRES_PASSWORD`, then the same value inside `DATABASE_URL` and `TEST_DATABASE_URL`.
- `SESSION_SECRET`, at least 32 characters and never typed by a person -
  `openssl rand -base64 24` is the whole job.
- `MASTER_PASSWORD`, the way back in when the salon password and the PIN are both lost.
- `SALON_PASSWORD` and `SALON_PIN`, which seed the database the first time the server starts
  and are **ignored afterwards**. Changing them later changes nothing; the master-password
  screen does. See [ADR-0017](docs/adr/ADR-0017-a-changeable-salon-password-a-pin-and-a-master-key.md).

The server refuses to start if any of them is missing, and names the one it wants.

One optional name, and the day it matters: `COOKIE_SECURE`. The session cookie follows `HOST`
by default - loopback means not `Secure`, anything else means `Secure`. **Set it to `true` the
day a proxy terminates TLS in front of this**, because that deployment leaves `HOST` on
loopback and the guess would send the session cookie in clear text. The startup log says which
way it went, every time.

```bash
npm run db:up      # Postgres in a container, bound to 127.0.0.1 only
npm run build
npm start          # migrates on startup, then serves the API
```

```bash
curl 'http://127.0.0.1:3000/api/day?date=2026-08-13'
```

That answers `{"error":"Bitte anmelden."}` with status 401, which is the point of ADR-0004: an
unauthenticated request gets no day at all, not a filtered one. To see a day from the command
line, trade the password for the session cookie first:

```bash
curl -c cookies.txt -X POST 'http://127.0.0.1:3000/api/login' \
  -H 'content-type: application/json' -d '{"password":"THE_ONE_YOU_PUT_IN_ENV"}'
curl -b cookies.txt 'http://127.0.0.1:3000/api/day?date=2026-08-13'
```

On a fresh database that answers `{"date":"2026-08-13","today":"...","employees":[],"entries":[]}`.
An empty day is the correct answer, not a broken one: there is no seed data, and staff are the
one thing the application still cannot create. The board needs at least one employee row before
it can show anything, and today that is an `INSERT` by hand; appointments themselves can be made
in the form as soon as a column exists. The database tests exercise entries and colours without
any of that.

The board itself is served from the same address, so `http://127.0.0.1:3000` shows it: the
login screen first, then, on a fresh database, `Für diesen Tag ist niemand eingeteilt.` until an
employee exists.
While working on the front end, `npm run dev` gives Vite on
[127.0.0.1:4173](http://127.0.0.1:4173) with hot reload, proxying `/api` to the server above.

`npm run db:down` stops the database. Add `-v` by hand if you want to delete its data.

## The checks

```bash
npm run verify     # typecheck, lint, unit tests, build - no database needed
npm run test:e2e   # browser tests (Playwright)
```

The database tests need Postgres and its URL. Vitest does not read `.env` into
`process.env`, so pass it explicitly:

```bash
export $(grep TEST_DATABASE_URL .env) && npm run test:db
```

They refuse to run against a database whose name does not end in `_test`, because they
truncate every table.

`npm run verify` is deliberately database-free, so a fresh clone passes it. CI runs
`verify`, the database tests and the browser tests as three separate jobs, plus
`npm audit`.

**A green pipeline proves the assertions somebody wrote. It says nothing about the
behaviours nobody thought to assert** - see [`rules/what-checks-prove.md`](rules/what-checks-prove.md).
Two of the four blockers found in the first code review were invisible to a fully green
suite, because the files they were in had no tests at all.

## The decision log

Eighteen decisions are settled and written down in [`docs/adr/`](docs/adr/), each with the
tempting wrong answer recorded next to it. Read the one that governs what you are about to
touch, and if it needs to change, write a new one that supersedes it. Never silently
re-decide.

| ADR | Ruling |
| --- | --- |
| [0001](docs/adr/ADR-0001-no-overlapping-appointments-per-employee.md) | An employee's appointments may never overlap - enforced by a Postgres exclusion constraint, not by application code |
| [0002](docs/adr/ADR-0002-employees-are-deactivated-never-deleted.md) | Employees are deactivated, never deleted - visibility half superseded by 0012 |
| [0003](docs/adr/ADR-0003-a-stale-save-is-refused.md) | A save against a stale version is refused |
| [0004](docs/adr/ADR-0004-one-shared-salon-password.md) | One shared salon password - and what that costs |
| [0005](docs/adr/ADR-0005-self-hosted-containers.md) | Self-hosted containers, not a managed platform |
| [0006](docs/adr/ADR-0006-the-api-is-the-only-door-to-the-database.md) | The API is the only door to the database |
| [0007](docs/adr/ADR-0007-appointments-are-stored-as-salon-local-wall-clock-time.md) | Times are salon-local wall clock, never absolute instants |
| [0008](docs/adr/ADR-0008-appointments-and-blocks-share-one-table.md) | Appointments and blocks share one table |
| [0009](docs/adr/ADR-0009-appointment-colour-is-assigned-per-day.md) | Colour is assigned per day, one per customer |
| [0010](docs/adr/ADR-0010-date-arithmetic-iso-weeks-and-month-steps.md) | ISO week numbers and month-step arithmetic |
| [0011](docs/adr/ADR-0011-the-screen-is-german-the-code-is-english.md) | The screen is German, the code is English |
| [0012](docs/adr/ADR-0012-a-deactivated-employee-leaves-the-board-entirely.md) | A deactivated employee leaves the board entirely, appointments included |
| [0013](docs/adr/ADR-0013-a-drag-is-the-edit-and-it-commits-on-release.md) | A drag is the edit, and it commits on release - with no undo |
| [0014](docs/adr/ADR-0014-a-block-may-say-why.md) | A block may say why, in its own field, drawn on the box |
| [0015](docs/adr/ADR-0015-core-hours-shade-the-board-and-refuse-nothing.md) | Core hours shade the board and refuse nothing |
| [0016](docs/adr/ADR-0016-hessen-holidays-are-a-list-in-the-code.md) | Hessen's holidays are a list in the code, and it expires loudly |
| [0017](docs/adr/ADR-0017-a-changeable-salon-password-a-pin-and-a-master-key.md) | A changeable salon password, a PIN, and a master key - built, except the PIN check, which has nothing to guard yet |
| [0018](docs/adr/ADR-0018-the-settings-screen-owns-staff-and-hours.md) | The settings screen owns staff and hours - **not yet built** |

Two of them are worth knowing before reading any code, because they explain why it looks
the way it does:

- **ADR-0001.** The no-overlap rule is a database constraint rather than a check in the
  application, because two saves arriving at once can both read a clear slot and both
  write. That is not a theory: with the constraint, one of two concurrent inserts survives;
  without it, both do and a stylist is double-booked.
- **ADR-0007.** An appointment is a date plus a wall clock time in the salon's own
  timezone, and every client renders it in salon time. Storing absolute instants is the
  textbook answer and it is a trap here - a stylist checking the board from abroad would
  see the salon's 10:00 as 09:00, convincingly.

## How work ships

The rules any contributor, human or agent, works under are in
[`AGENTS.md`](AGENTS.md) and the files under [`rules/`](rules/). Two gates outrank
everything: **less is more** (do not write an unnecessary character) and **facts only**
(never state a cause you have not read).

Work happens on a short-lived branch, never on `main`. `npm run verify` is green before
every commit. Then a pull request, and before it merges the change gets **two review
passes, each by a mind that did not write it**: one attacking the logic, one looking only
for security holes. `.claude/agents/` holds both, plus a researcher that checks facts
against live sources and a ux-reviewer that walks a screen cold.

That process is not decoration. On the first code branch both passes returned NO-SHIP
independently and between them found an empty `HOST` binding every interface on an
unauthenticated API, a validator that handed callers a stack trace, a database restart that
killed the process, and a colour rule that did the precise opposite of what its own comment
claimed.

## What is enforced, and what is convention

An instruction file is context, not a mechanism. Honesty about which rules have teeth:

| Rule | What holds it | Honest label |
| --- | --- | --- |
| No commit on `main` | `.claude/hooks/no-main-commit.sh` exits 2 | **Blocks, in Claude Code only.** Other tools and a human terminal never run it. |
| Two review passes before push | A hook prints a reminder on `git push` | **Reminds only.** Skipping review is a choice, not an accident. |
| `npm run verify` green | `.github/workflows/ci.yml` on every pull request | **Runs server-side.** Whether a red check can still merge depends on branch protection. |
| No secret in a commit | Nothing | **Convention**, plus `.gitignore` covering `.env`. Read `git diff --cached` before every commit. |
| Everything else | The person or agent reading it | **Convention.** It binds by being read, which is why `AGENTS.md` is short. |

## License

[MIT](LICENSE).
