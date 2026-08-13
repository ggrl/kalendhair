-- ADR-0017: the salon password stops being an environment variable and becomes a hash the
-- salon can change from a screen. The environment keeps the signing secret and the master
-- password, and supplies these two once, as seeds.

CREATE TABLE salon_credential (
  -- One salon, one row. ADR-0004 gives everybody the same password, so there is nothing to
  -- key this by, and the check is what stops a second row appearing and making "the salon
  -- password" a question with two answers.
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- scrypt, salt and key hex-encoded and separated by a colon. Never the password itself.
  password_hash text NOT NULL,

  -- The four-digit PIN that guards the settings screen, hashed the same way. Four digits is
  -- ten thousand possibilities, so the hash does not make this a strong secret and is not
  -- pretending to - it keeps the PIN out of a database dump and out of a backup, which is
  -- where a shared PIN would otherwise be readable next to the password.
  pin_hash      text NOT NULL,

  -- Carried in every session cookie and checked on every request, so that incrementing it
  -- logs everybody out at once. ADR-0017: the reason a salon password gets changed is that
  -- somebody left, and a cookie signed only by the session secret would outlive the change.
  version       integer NOT NULL DEFAULT 1
);
