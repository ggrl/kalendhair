# ADR-0027: Appointments and blocks are deleted a year after their date

- Status: accepted and built, 2026-09-30
- Amends [ADR-0002](ADR-0002-employees-are-deactivated-never-deleted.md), which kept a deactivated
  employee's appointments for as long as the row lived

## Context

Nothing was ever deleted. Every customer name, treatment and note stayed in the database for as
long as the database did. The owner ruled on 2026-09-30 that data older than a year is deleted
automatically, before the board is deployed, and asked for the simplest mechanism that does it.

## Decision

**The live database holds no appointment or block dated before the same calendar day one year
ago, a day late at most.** The run is every 24 hours from startup, not at midnight, so a row can
outlive its line by up to a day, and by another day for each run that fails. Never early. Today being 2026-09-30, 2025-09-29 goes and 2025-09-30 stays.
On 29 February the line is 28 February of the year before. "Today" is the salon's date, from
`todayIn`, not the server's timezone, as everywhere else (ADR-0007). With the clock right, no
future date is ever touched.

`server/retention.ts` runs one `DELETE` on the `appointment` table, drawing the line with the same
`interval '1 year'` that `server/suggestions.ts` already uses, so the suggestion window and the
retention window cannot mean different years. The server runs it on startup and every 24 hours
after. A failed first run stops the server the way a failed migration does; a failed later run is
logged and retried the next day. Each run logs how many rows went, never what was in them.

Blocks go by the same rule, because they share the table (ADR-0008) and a reason such as "Krank"
is personal data about an employee.

## Consequences

- **A day older than a year shows an empty board, with no notice.** It cannot be told apart from
  a day nobody booked. Nobody has asked to look that far back.
- **ADR-0002's "history stays readable" now holds for a year.** A leaver whose appointments are
  all older than that has none left, which makes them deletable in the settings screen, since
  that screen deletes anybody who holds no appointment right now.
- **Reactivating a leaver brings back only their last year.** The settings screen's hint said
  "Nichts wird gelöscht: beim Aktivieren ist alles wieder da" and now says the last year comes
  back and older appointments are deleted - changed on the owner's call, the one screen this
  touches. `migrations/001_init.sql` says
  "reactivating brings all of it back" in the comment on `active`. That comment is now wrong and
  stays, because an applied migration is not edited.
- **"Today" is only as right as the host clock.** A clock years ahead would delete every row,
  future ones included. Not guarded, because nobody has seen it; the daily log line with its
  count is where it would show.
- **An appointment deliberately booked on a date older than a year is accepted and disappears on
  the next run.** Not refused, because nobody has been seen doing it.
- **The promise covers the live database only.** Every backup is a full copy, so a deleted row
  lives on in every dump taken before it went. How long dumps are kept is decided with the
  backup, not here.
- **Name suggestions lose nothing.** They were already limited to the same year.

## Alternatives rejected

- **`pg_cron`, so Postgres runs the delete itself.** Another extension to install, and the
  official `postgres:17-alpine` image this project runs was not checked for it. The server
  already owns every connection (ADR-0006) and every other rule about the data.
- **A cron job on the host running `psql`.** A second process connecting to the database, which
  ADR-0006 forbids.
- **Retention for employees, core hours or anything else.** Not asked for, and none of it is a
  customer's data.
- **A setting for the period.** One year is the ruling; a setting is a second place to be wrong.
