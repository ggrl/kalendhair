# ADR-0028: The backup is encrypted on the server and pulled by the salon's laptop

- Status: accepted, 2026-10-01. Written into `DEPLOYMENT.md` Step 10 and tested off-server.
  On the real server since 2026-10-04: the nightly dump runs and one restore was performed.
  The laptop pull (10c to 10e) is not set up yet
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
- **The laptop trusts the server as little as it can.**
  - It takes only names of the server script's exact shape, from a listing, and fetches each
    by that name, so no server-chosen path reaches a download.
  - It never replaces a copy it already has.
  - A copy goes only once seven newer ones have arrived *and* it arrived more than seven days
    ago, by the laptop's clock. A server that stops sending leaves the last seven for good.
  - Three review rounds on 2026-10-01 shaped this. The first version kept the seven newest
    names, so a server taken over could replace every copy in one run. The second pruned
    everything over a week old, so a server that merely stopped emptied the laptop. The third
    was open, on Windows, to a name with a backslash writing outside the download folder,
    according to one reading of the Windows OpenSSH source; another reading said the client
    rejects such names. Neither was run on Windows, and the listing makes the question moot.
- **The server keeps its newest seven.** Each side prunes only after its own step succeeded,
  so a week of failures leaves what was there instead of nothing.
- **Nothing alerts.** A person looks at the laptop's folder regularly. The owner chose that
  over a dead man's switch, which would be one more outside account.

## Consequences

- **A deleted appointment survives about a week in backups.** Seven nightly dumps on the
  server; on the laptop, a copy goes a week after it arrived once newer ones keep coming. So
  in normal operation it is gone everywhere roughly a year and a week after its date -
  provided the laptop's copies are not copied elsewhere. If the server's dumps stop while the
  laptop still connects, the laptop keeps its last seven, and the rows in them, until dumps
  resume. A `.part` from a failed night goes after the next good one, because a cut-off dump
  still holds real rows.
- **A server taken over can still replace the laptop's copies, and nothing shows it.** Copies
  more than a week old go in one run of seven new files, such as after a holiday with the
  laptop off. Fresher ones go in about a week of one plausible file a night, which even
  decrypts, since the server holds the public key. What the design stops is an overwrite, a
  path smuggled in a name, and a server that simply stops. Only a restore detects the rest -
  the drill, done regularly, or a second copy the server never reaches.
- **After a break-in, restore onto a new server,** never the one broken into: the private
  key pasted there is the attacker's.
- **A server taken over can also fill the laptop's disk** by offering huge files. That stops
  the backups loudly rather than deleting any.
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
  against that container: hostile names, an overwrite, a burst while the copies were under a
  week old, a stopped server, and a failed run. **Not tested: Windows, Windows PowerShell 5.1, Task Scheduler, and a real server.**
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
