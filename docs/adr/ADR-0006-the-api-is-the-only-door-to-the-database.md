# ADR-0006: The API is the only door to the database

- Status: accepted
- Date: 2026-08-12

## Context

A second client is planned: an iOS app showing the same calendar. The reasoning offered
for keeping Postgres in its own container was that the app could then use the same data
from the database.

That reasoning does not survive contact with what it would require. A client talking
to Postgres directly means the database port open to the internet, database credentials
shipped inside an app binary where anyone can extract them, and every client free to
write whatever it likes. It would also put both hard rules on the wrong side of the
boundary: ADR-0001's no-overlap constraint and ADR-0003's stale-save refusal are
enforced by the server, and a client that bypasses the server bypasses them.

The decision to keep Postgres is unaffected and correct. Only the reason changes. What
two clients share is the API.

## Decision

The Node server is the only process that connects to Postgres. Every client - the web
board today, an iOS app later, anything after that - reaches the data over the HTTP
API and no other way.

Two consequences for how the API is built, starting now rather than retrofitted:

- It is a plain HTTP and JSON interface, shaped by what a calendar client needs, not by
  what the React components happen to hold. No response is designed around a specific
  screen.
- The database port is never published to the host or the internet. In `docker compose`
  the database is reachable on the internal network by the server and nothing else.

## Consequences

- Every rule has exactly one home, which is what `rules/coding-standards.md` asks for.
  A second client cannot violate a rule it cannot reach around.
- An iOS app is a client to write, not a schema to re-implement. It gets no privileged
  access for being native.
- The API is a contract with more than one consumer, so a breaking change to it breaks
  a shipped app that cannot be updated in step. That cost arrives with the second
  client, not before, but the shape of responses should not be casual now.
- Any future need for direct database access - a reporting tool, an export, a
  migration script - is a deliberate decision against this ADR, made by superseding it,
  not by opening the port.

## Alternatives rejected

- **Let each client connect to Postgres directly.** Rejected as above. It is the
  dangerous reading of "the app uses the same data from the database" and it is worth
  writing down precisely because it sounds efficient.
- **A separate, second API for the app.** Two servers, two sets of rules, two places
  for the overlap check to be subtly different. Rejected: one business rule lives in
  one place.
