# ADR-0005: Self-hosted containers, not a managed platform

- Status: accepted
- Date: 2026-08-12
- Supersedes: the earlier proposal in this brief to deploy to Vercel with serverless
  functions. That was never merged and never built.

## Context

The thing has to be run and tested locally first, on one machine, with fake data. Only
once it works does it move to a VPS. Nobody wants a platform account, a marketplace
database or a bill in between.

The risk in that shape is the gap between the two environments. Something that works
on a laptop and then meets a different Node version, a different Postgres version or a
missing system library on the VPS costs a day of chasing differences, and the failure
arrives at the worst moment: after the salon has been told it is ready.

## Decision

The application runs as containers, orchestrated by `docker compose`:

- one long-running Node server that serves the built front end and answers the API
- one Postgres container, its data on a named volume

The same compose file is what runs locally now and on the VPS later. On the VPS it sits
behind a reverse proxy terminating TLS for a real domain, because ADR-0004 puts a single
shared password in front of everything, and over plain HTTP that password, the session
cookie and every customer name are readable in transit.

## Consequences

- One long-running server replaces serverless functions, which makes several things
  simpler: connection pooling is ordinary, and holding an open connection for server
  push becomes possible rather than questionable.
- **One stated reason in the brief expired with this decision.** Polling rather than
  server push was argued partly on serverless functions possibly being unable to hold a
  connection open. A long-running server plainly can. Polling stays, but now on
  simplicity alone: it survives proxies, sleeping laptops and dropped wifi with no
  reconnection logic to get wrong. A justification that has stopped being true is worth
  more retired than quietly reused.
- Docker is not a safety feature. It does not back anything up, encrypt anything in
  transit, or stop a container being restarted into an empty volume. Those remain
  separate, deliberate work. See the backup condition in the brief, which is blocking
  before real data.
- Running it requires Docker on the machine, which is a real dependency for anyone
  cloning this repository.
- Nobody is on call. A VPS that stops is a salon with no appointment book, and there is
  no platform underneath to restart it.

## Alternatives rejected

- **Vercel with serverless functions and a marketplace Postgres.** Least operational
  work and no VPS to maintain. Rejected: it cannot be run and tested locally in a way
  that resembles production, it puts customer data on a third-party platform and an
  account nobody wants yet, and the goal is explicitly to self-host.
- **Plain Node and Postgres on the VPS with systemd, no containers.** Fewer moving
  parts and nothing new to learn. Rejected because the laptop and the VPS then drift
  apart within weeks, which is the exact failure this decision exists to prevent.
- **SQLite instead of Postgres.** Genuinely attractive here: no second container, no
  connection string, and a backup is copying one file, which matters for a salon with
  no sysadmin. Rejected on ADR-0001. Postgres is believed to be able to express
  no-overlap as a real database constraint, and SQLite is believed not to, leaving the
  rule resting on a transaction plus its single-writer behaviour. Both beliefs are
  unread and marked in ADR-0001 as something to confirm before writing. If that check
  reverses them, this alternative deserves reopening.
