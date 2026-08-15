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

### One named exception, for local development only

Amended 2026-08-12, when the first code was written. Until the server itself runs as a
container beside the database, the server and the test suite run on the host and cannot
reach an unpublished port. So `docker-compose.yml` binds the database to `127.0.0.1`
only.

This is an exception, not a relaxation. Loopback is not the network and not the internet,
the data behind it is fake names on one developer's machine, and the binding is deleted
the moment the application service joins the compose file. **Stage two publishes nothing.**
If you find this port bound to anything other than `127.0.0.1`, that is a defect.

#### Amended 2026-08-15, when the application service joined

That day arrived. `docker-compose.yml` now runs the server beside the database and
**publishes no database port at all**, which is the rule above, met literally.

Half of the exception's stated reason expired with it and half did not: the server no longer
runs on the host, but `npm run test:db` still does, and it still cannot reach an unpublished
port. So the exception survives, narrowed to the test suite - the published port and, with
it, the script that creates `salon_test`, which has no business on the salon's machine
either. Both moved to
`docker-compose.dev.yml` - a second file that the server never loads and that the deployment
never names.

The split is the point. `docker compose up -d` on the VPS cannot publish the port even by
accident, because publishing it now takes a deliberate second `-f`. Keeping one file with a
port in it and remembering not to use it in production is exactly the arrangement this
paragraph was written to prevent.

### The absence of a CORS header is part of this decision

Added after the board landed. The built front end is served from the same origin as the API,
so the browser never makes a cross-origin request and **no `Access-Control-Allow-Origin`
header is set anywhere.** That absence is load-bearing: it is what stops a page on another
site reading a day of customer names out of a logged-in browser.

The tempting undoing of it is "just add CORS so the app can call it". A native iOS app is not
a browser and is not subject to the same-origin policy, so it needs no such header. Anything
that appears to require one is a browser on another origin, which is the case this is meant
to refuse. Serve it from this origin instead.

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
