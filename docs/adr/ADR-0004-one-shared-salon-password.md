# ADR-0004: One shared salon password, and what that costs

- Status: accepted
- Date: 2026-08-12

## Context

The day sheet is a list of named real people and the time each of them will physically
be at a known address. Under GDPR it is personal data, and the salon is the controller
of it. On the open internet it is readable by anyone who finds the URL, and an unlisted
URL is not a private one: addresses leak through browser history, shared screens and
referrer headers, and a leaked URL cannot be un-leaked.

So the board needs authentication. The question was which kind, for six people who
work in one room.

## Decision

One shared salon password, entered once and exchanged for a signed, httpOnly session
cookie.

Every endpoint that returns or changes appointment data requires a valid session. An
unauthenticated request returns no customer data - not a filtered day, not an empty
shell that leaks names in an error, nothing.

The password and the signing secret live in environment variables. They never appear
in a tracked file, a log line, or a client bundle.

## Consequences

- **There is no audit trail.** Nobody can tell who moved an appointment or who deleted
  one, because everybody is the same session. This is the accepted cost, and it is the
  first thing to reconsider if a dispute about a change ever matters.
- **Changing the password means telling everyone.** There is no per-person revocation.
  When a stylist leaves, the only way to cut their access is to rotate the shared
  password for the whole salon.
- Session handling is written carefully rather than invented: signed cookie, httpOnly,
  secure, sensible expiry. No hand-rolled cryptography.
- The login attempt path needs rate limiting. A single shared password is one guessable
  secret protecting everything.

## Alternatives rejected

- **Individual accounts via a managed provider** such as Clerk, a native Vercel
  integration. Gives per-person accountability and clean offboarding, both of which
  this decision gives up. Rejected as more moving parts than six people in one room
  need today. This is the natural successor if the consequences above start to hurt.
- **Individual accounts built here**, owning the user table, password hashing and
  sessions. Rejected outright: it is a solved problem, and rolling it yourself is how
  small businesses end up sending breach notifications.
- **No login, unlisted URL.** Rejected. Real customer names go in this.
- **Restrict to the salon network.** Avoids passwords, and breaks the moment somebody
  wants to check the day from home, which is most of the point.
