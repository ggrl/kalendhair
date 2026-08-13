# ADR-0004: One shared salon password, and what that costs

- Status: accepted for the web board. **The revisit below happened on 2026-08-13**, and
  [ADR-0017](ADR-0017-a-changeable-salon-password-a-pin-and-a-master-key.md) supersedes the
  environment-variable password: it becomes a hash in the database that the salon can change, with
  a PIN in front of the settings screen and a master password in the environment. One shared
  password for the salon, the session cookie, and the warning below about personal phones all
  stand, and none of it is built yet.
- Date: 2026-08-12

## Revisit before building

An iOS app is planned, which changes the threat this decision was weighed against. A
shared password is reasonable for machines that live in the salon. A phone leaves the
building, gets lost, and belongs to someone who may stop working there - and the only
way to cut one person's access here is changing the password for everybody.

The decision below is unchanged and still correct for the web board. It is flagged
because retrofitting per-person identity means adding a table of people and redoing
every session, which is a migration rather than a decision. Settle this before the
first line of authentication code, not after.

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
- **The deadline is whichever comes first: the first real customer name, or the first bind
  that is not loopback.** The second arrives quietly and is the one to watch. Deploying to
  the VPS behind TLS is precisely the act that stops loopback protecting anything -
  `server/config.ts` accepts `HOST=0.0.0.0` because that is a deliberate choice, and it is
  the deliberate choice a deploy makes. A deploy is a bad moment to discover the board is
  public.
- **A `Host` header allowlist now covers both doors with one check.** Since the built board
  is served from the same origin as the API, one guard on the way in protects the JSON and
  the HTML together. That was not true before the front end existed.
- Noted here by the security review of the first code so it is not rediscovered. Until authentication exists, the
  server is protected only by binding to loopback, and loopback does not stop DNS
  rebinding: a page the salon's own browser visits can point a hostname at `127.0.0.1` and
  read the API same-origin. No CORS header is set, which is what stops a plain cross-origin
  `fetch`, so rebinding is the remaining path. The allowlist is the cheap half of the fix
  and authentication is the real one. Both are due before the first real customer name is
  entered.

## Alternatives rejected

- **Individual accounts via a managed authentication provider.** Gives per-person
  accountability and clean offboarding, both of which this decision gives up. Rejected
  as more moving parts than six people in one room need today, and it puts staff
  identities on a third party when ADR-0005 chose self-hosting to avoid exactly that.
  Still the natural successor if the consequences above start to hurt.
- **Individual accounts built here**, owning the user table, password hashing and
  sessions. Rejected outright: it is a solved problem, and rolling it yourself is how
  small businesses end up sending breach notifications.
- **No login, unlisted URL.** Rejected. Real customer names go in this.
- **Restrict to the salon network.** Avoids passwords, and breaks the moment somebody
  wants to check the day from home, which is most of the point.
