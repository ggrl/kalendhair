# ADR-0028: The backup is encrypted on the server and pulled by the salon's laptop

- Status: accepted, 2026-10-01. Written into `DEPLOYMENT.md` Step 10 and tested off-server;
  not yet run on a real server, and the restore the brief demands has not happened
- Settles what [ADR-0027](ADR-0027-appointments-are-deleted-a-year-after-their-date.md) left
  open: how long a deleted appointment survives in a backup

## Context

The brief makes a backup that leaves the server, plus one restore actually performed, the
condition for putting in one real appointment. `DEPLOYMENT.md` had a nightly `pg_dump` recipe
nobody had run: unencrypted, never pruned, and with its off-server copy left as a placeholder.

The owner asked for the database only, daily, somewhere free. Google Drive, Cloudflare R2,
iCloud Drive and the salon's own Windows laptop were compared against their vendors' current
documentation on 2026-10-01.

## Decision

- **The server dumps nightly and encrypts to a public key with `age`.** The private key is
  made off the server and kept in the owner's password manager. The server cannot read its
  own backups, so neither can anybody who breaks into it.
- **The laptop pulls, once a day, over SFTP.** Its login is locked by OpenSSH to reading one
  directory: no shell, no writing, no forwarding. The server holds no credential for where
  the backups end up.
- **The laptop trusts the server's names as little as it can.** It never replaces a copy it
  already has, and it keeps what arrived in the last seven days by its own clock. A server that
  has been taken over can offer junk, but cannot overwrite a copy on the laptop or push one out:
  each stays seven days after it arrived. Both reviews on 2026-10-01 found the first version
  kept the seven newest *names*, which let such a server replace every good copy in one run.
- **The server keeps its newest seven.** Each side prunes only after its own step succeeded,
  so a week of failures leaves what was there instead of nothing.
- **Nothing alerts.** A person looks at the laptop's folder regularly. The owner chose that
  over a dead man's switch, which would be one more outside account.

## Consequences

- **A deleted appointment survives about a week in backups.** Seven nightly dumps on the
  server, seven days of arrivals on the laptop, so roughly a year and a week after its date it
  is gone everywhere - provided the laptop's copies are not themselves copied elsewhere, and
  the laptop has had a good run since. A `.part` from a failed night goes after the next good
  one, because a cut-off dump still holds real rows.
- **A server taken over is still bad news, just not a silent wipe.** It can stop sending good
  dumps and send junk instead. What it cannot do is undo what the laptop already holds, so the
  week of copies there is what a restore after a break-in comes from.
- **The laptop is the only off-server copy.** Lost or broken, it takes them with it, but
  reveals nothing: every file is encrypted.
- **A failure is only as visible as the next look.** Seven per side means one noticed within
  a week has lost nothing.
- **Lose the private key and every backup is noise.** The password manager holding it, and
  every `.env` value, is part of the backup even though neither is in it.
- **A day the laptop stays off is a day without an off-server copy.** It catches up on the
  next logon; the server keeps seven meanwhile.
- **Tested, and where.** The server blocks ran verbatim on a Debian 12 container, with a
  stand-in for `docker compose`: pruning, a failing dump, and every refusal of the laptop's
  login. A real dump of the development database went through encryption and back into a
  scratch database identical in every count. The laptop script ran in PowerShell 7 on Linux
  against that container, including both ways a taken-over server could have wiped it. **Not tested: Windows, Windows PowerShell 5.1, Task Scheduler, and a real server.**
  `DEPLOYMENT.md` Step 10 names each of those as a check to do on the day.

## Alternatives rejected

- **Google Drive.** rclone's shared login "is being retired and will stop working during
  2026" (rclone.org/drive), so it needs its own Google Cloud project, published "In
  production" or its token dies after seven days. The token also dies after six months
  unused, the 15 GB is shared with Gmail and Photos, and deleted files sit in the trash
  counting against it for 30 days.
- **iCloud Drive.** rclone's backend is "Experimental", its trust token "is valid for 30 days"
  and then needs a person and two-factor again, it rests on Apple's private web login, which
  Apple changed in 2026, and Apple's terms forbid access "through any automated means, like
  scripts".
- **Cloudflare R2.** The technically cleaner fit - a bucket-scoped key that does not expire -
  and the one to reach for if the laptop stops being there. Turned down because the laptop
  is simpler to own, needs no outside account - R2 very probably needs a payment card on
  file - and a compromised server holds no key to it. R2's own lifecycle rule
  would also have deleted by age, which is the failure above.
- **Unencrypted dumps.** The file carries health data in `notes` and every password hash.
- **Deleting by age.** See above: a silent week of failures would delete the last good copy.
- **An alerting service.** The owner's call: one more account, for a check a person makes
  anyway.
