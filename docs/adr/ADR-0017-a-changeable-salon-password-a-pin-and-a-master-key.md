# ADR-0017: A changeable salon password, a PIN, and a master key

- Status: accepted, **not yet implemented**
- Date: 2026-08-13
- Supersedes: the "the password lives in an environment variable" half of
  [ADR-0004](ADR-0004-one-shared-salon-password.md)

## Context

ADR-0004 settled one shared salon password exchanged for a signed httpOnly cookie, with the
password and the signing secret in environment variables, and marked itself to be revisited
before a line of authentication was written. This is that revisit, and it happens because the
owner asked for a settings screen that can change the password - which an environment variable
cannot do.

The interview ran four rounds and changed shape in every one. What follows is the end of it,
not the start: an email-based reset was proposed and dropped as too much machinery for a
self-hosted salon, and the admin guard moved from re-entering the password to a PIN.

Nothing here is built. This ADR exists so the next session does not re-decide it.

## Decision

**Three credentials, with three different homes and three different jobs.**

**The salon password is a hash in the database, and the salon can change it.** `scrypt` from
`node:crypto`, so no new dependency. It is what every member of staff gets, and it buys the
signed httpOnly session cookie ADR-0004 already specifies. The signing secret stays in the
environment, where ADR-0004 put it.

**Changing the password logs everybody out.** The owner asked for this directly, and the reason
is the reason a password gets changed: somebody left. A cookie signed only by the session secret
would survive the rotation, so the session has to carry something that the change invalidates -
a credential version in the row, incremented on every password change and checked on every
request.

**A four-digit PIN guards the settings screen, and nothing else.** It sits behind a valid
session, so it is not the boundary between the salon and the internet - it is the boundary
between using the board and changing it, and the owner decides who gets it.

**The PIN has no lockout.** Ten thousand guesses from the developer console of a logged-in board
is minutes, and that is accepted: everybody who can reach the PIN prompt is already trusted with
every customer name on the board. What sits behind the PIN is the salon password, so the honest
statement is that the PIN slows a colleague down and stops nobody determined. The owner made
this call with that in front of them.

**The master password lives in the environment and opens exactly one screen:** set a new salon
password and a new PIN. It gets no board session, reads no day, sees no customer name. It is the
answer to a forgotten PIN and a lost password, and it is the only credential the settings screen
cannot change.

**`SALON_PASSWORD` and `SALON_PIN` seed the database row when it is absent, and are ignored
after that.** Otherwise a restart would silently undo every change made in the screen. No
default values in any tracked file, not even as an example: `rules/secrets.md` forbids it, and
`POSTGRES_PASSWORD` already sets the pattern. The server refuses to start if the seeds, the
session secret or the master password are missing, and says which.

**No email, anywhere.** No reset links, no notifications when the password or anything else
changes.

## Consequences

- **Being locked out has two floors, and both need somebody with access to the machine.** The
  master password from the environment, or the documented command that sets the row directly.
  For a self-hosted salon that is the honest arrangement: there is no third party to ask.
- **A password change is a small outage.** Everybody is logged out, including whoever is at the
  desk, and they all need the new password. That is what makes it useful when somebody leaves.
- **The PIN is convenience, recorded as such.** If it ever needs to be a real boundary, that is a
  lockout and probably per-person accounts, which is a new ruling and a bigger one.
- **`.env.example` gains four names with no values**, and the startup check gains four reasons to
  refuse. A missing secret stopping the server is the behaviour that already exists for the
  database password.
- ADR-0004's rejected alternatives still stand, and its own warning still stands: a shared
  password on personal phones is what the planned iOS app will put in the salon's hands, and
  nothing here changes that.

## Alternatives rejected

- **Email reset, with confirmation mails for password and address changes.** The owner's first
  design and the one they withdrew: it needs a provider, an API key, a domain to send from, an
  unauthenticated endpoint to rate-limit, and a reachable address - none of which stage one has,
  and a link to `127.0.0.1` is not a reset.
- **Re-entering the salon password at the settings door.** My recommendation, and rejected as
  less convenient than four digits. Its advantage was needing no second secret; its disadvantage
  is that everybody already knows the password, so it separated nothing.
- **A lockout after five wrong PINs.** My recommendation. Rejected as friction, with the cost
  understood.
- **The master password granting a full session.** One line instead of a screen. Rejected because
  it would be a permanent second login that never rotates and cannot be revoked without a
  redeploy.
- **First visit chooses the credentials.** No shell needed, and on a VPS the first stranger to
  reach the port owns the salon.
- **Per-person accounts with roles.** The real answer to "who changed this", and out of scope
  here exactly as ADR-0004 already decided. This ADR keeps the door open by adding no mechanism
  that assumes one shared identity beyond what already exists.
