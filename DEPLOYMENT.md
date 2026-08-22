# Deploying kalendhair

A step by step for putting this on a server with HTTPS, written to be provider neutral.
It works the same on an Azure VM for testing and on any VPS later. Where a step is
specific to one provider it says so and you can skip it.

Everything here was written from the code in this repository, not from a general template.
Where something is not built yet, it says so rather than pretending.

---

## Read this before you start

Three facts about the current state of the repository. They change what deployment looks
like, and none of them is obvious from the outside.

**1. The whole stack is `docker compose up -d`.** Two services, as ADR-0005 describes: the
Node server that serves the built board and answers the API, and Postgres with its data on
a named volume. The host needs Docker and git, and **not** Node: the build happens inside
the image. The reverse proxy that terminates TLS is the one piece that stays on the host,
because it is the thing holding the certificate.

**2. `TRUST_PROXY=1` is not optional behind a proxy, and it is not safe without one.**
`server/app.ts` keeps **three** counters keyed on the caller's address: login at 20 per 5
minutes, the master-password reset at 20 per 5 minutes, and wrong PIN attempts at 10 per 5
minutes. Both ways of getting this wrong are real and they fail in opposite directions:

- **Unset behind a proxy**, every request carries the proxy's address, so all three counters
  become one budget shared by everybody. A stranger holds the salon's front door shut at
  roughly four requests a minute - **and the recovery door with it**, since the
  master-password reset has its own bucket that collapses the same way.
- **Set with nothing in front**, `request.ip` becomes whatever the caller writes in an
  `X-Forwarded-For` header, so the same stranger rotates addresses and never runs out.
  Measured on Express 5: with one hop trusted, a direct request claiming `9.9.9.9` gets
  exactly that.

So it defaults to trusting nothing, and step 5 has you set it on the server where the proxy
actually exists. The startup log says which way it went.

**3. The server uses two relative paths.** `express.static('dist')` and the migration
runner's `'migrations'` are both relative to the working directory, so the process must be
started with its working directory at the project root or it serves no board and finds no
migrations. The `Dockerfile` sets `WORKDIR /app` and copies both directories there, so
inside a container this is already handled. It is written down because it is invisible, and
because anyone who later runs this outside a container has to know it.

Two things the server does for you on every start, so no manual step exists for either:
it **runs any unapplied migrations** (under a Postgres advisory lock, so two instances
starting together is safe), and it **seeds the salon password and PIN from the environment
the first time only**, ignoring them ever after.

---

## Step 0: what you need

- A server running a current Linux. Anything Debian or Ubuntu based matches the commands
  below; adjust the package manager otherwise.
- **A hostname.** Not optional, though it does not have to be a domain you bought.
  Certificate authorities do not issue publicly trusted certificates for bare IP
  addresses, so without a hostname there is no HTTPS, and without HTTPS the shared
  password and every customer name cross the network readable. On Azure you get a usable
  hostname for free: see [Testing on Azure without buying a domain](#testing-on-azure-without-buying-a-domain).
  For the real deployment, buy one.
- Ports 80 and 443 reachable from the internet. Port 80 is needed even though the board is
  HTTPS only, because that is how the certificate challenge arrives.

Size: this is one salon, and at runtime the smallest instance any provider sells is enough.
Give it at least 2GB of RAM if you build the image on the box, because `npm ci` plus the
TypeScript and Vite build needs considerably more memory than serving the result does.

---

## Step 1: create the server and point the domain at it

Create the smallest Linux VM your provider offers, then create a DNS **A record** pointing
your hostname at its public IP address.

Do this first and let it propagate. Certificate issuing in step 8 fails if the hostname
does not yet resolve to this machine, and that failure is confusing when you meet it for
the first time.

Check it from your laptop before continuing:

```bash
dig +short board.example.com
```

That must print the server's public IP.

**On Azure specifically:** the VM's public IP defaults to dynamic, which means it can
change on deallocation and silently break both DNS and your certificate. Set it to static
in the portal under the IP resource, or accept that a stopped VM may come back on a
different address.

### Testing on Azure without buying a domain

**You do not need to buy a domain for a test box.** Azure gives every public IP an optional
free DNS name label. Set it on the **Public IP** resource, under Configuration, and you get:

```
<your-label>.<region>.cloudapp.azure.com
```

for example `kalendhair-test.westeurope.cloudapp.azure.com`. The label only has to be unique
within that Azure region. It is a real, publicly resolvable name, it survives the underlying
IP changing, and it needs no DNS record of your own. Put it in the Caddyfile in step 8
exactly as you would a purchased domain and everything else in this guide is unchanged.

**The catch, and it is worth knowing before it bites you.** Let's Encrypt limits certificate
issuance per registered domain to **50 certificates every 7 days**, refilling at roughly one
every 202 minutes. For `cloudapp.azure.com` names that budget is **not yours alone** - it is
shared with other Azure customers whose names sit under the same suffix, and you have no
control over them. People do hit this and the failure reads as `too many certificates already
issued`, naming a domain you have never heard of. It is nothing you did wrong and there is
nothing to fix; you wait, or you use a hostname you own.

Two things make this a non-issue in practice:

- **Point Caddy at Let's Encrypt's staging environment while you are still iterating.** The
  certificate it issues is not publicly trusted, so your browser will warn and you click
  through, but staging has far looser limits and nothing you do during setup touches the real
  budget. Switch to production once the deployment actually works. In the Caddyfile:

  ```
  board-test.westeurope.cloudapp.azure.com {
      tls {
          ca https://acme-staging-v02.api.letsencrypt.org/directory
      }
      reverse_proxy 127.0.0.1:3000
  }
  ```

  Delete the `tls` block to move to a real certificate.

- **Do not tear the VM down and rebuild it repeatedly with production certificates.** Each
  rebuild is another certificate against a shared budget.

**Use the Azure hostname for testing only.** For the salon's actual deployment, buy a domain:
the rate limit is then yours alone, the name is yours if you change provider, and
`cloudapp.azure.com` disappears the day you stop paying Azure.

---

## Step 2: close the machine before you open it

Firewall first, then services, so nothing is ever listening before the rules exist.

**And know what this firewall does not cover.** Docker publishes ports by writing its own
iptables DNAT rules, which are evaluated before `ufw`'s chain - so `ufw` does **not** filter
a container port published to `0.0.0.0`. That is not a problem in this deployment, because
the only port it publishes is the app's, bound to `127.0.0.1` and never to a public address,
which is what actually keeps it private. It matters the day somebody drops the `127.0.0.1:`
prefix from a `ports:` entry and assumes `ufw` is still covering them. It would not be.

Open only 22, 80 and 443:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

**Azure and most clouds have a second firewall in front of this one.** On Azure it is the
Network Security Group attached to the VM or its subnet, and it is the one that actually
decides what reaches you. Allow 22, 80 and 443 there too. A rule that exists in `ufw` and
not in the NSG does nothing, and the reverse is the more dangerous mistake.

**Never open 5432.** `docker-compose.yml` publishes no database port at all, which is
ADR-0006's rule: the server reaches Postgres over the compose network and nothing else can
reach it from anywhere. The two things only a development machine needs - that loopback
publish, and the script that creates the `salon_test` database - both live in
`docker-compose.dev.yml`, a file the server never loads.

---

## Step 3: install Docker

Docker is the only runtime dependency. **You do not need Node on the server** - the build
happens inside the image, using the Node version the `Dockerfile` pins.

Install Docker Engine and the Compose plugin from Docker's own instructions for your
distribution, then confirm:

```bash
docker --version
docker compose version    # must be 2.24 or newer
```

**Compose 2.24 is a real floor, not a suggestion.** `docker-compose.yml` uses the
`env_file: - path: ... required: false` long form, which older plugins reject outright. A
distribution's own `docker-compose` package is often well behind, which is why this says to
install from Docker rather than from `apt` by default.

---

## Step 4: create a user and get the code

Do not run this as root. Give it its own unprivileged user that owns nothing else:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin kalendhair
sudo mkdir -p /srv/kalendhair
sudo chown kalendhair:kalendhair /srv/kalendhair
sudo chmod 755 /srv/kalendhair
```

**`--no-create-home` and the explicit `chmod` are both deliberate.** With
`--create-home --home-dir /srv/kalendhair` the directory arrives holding a copy of
`/etc/skel`, and `git clone` then refuses it: `destination path already exists and is not
an empty directory`. That home would also be mode `750`, which makes every `cd
/srv/kalendhair` later in this guide fail for your own admin account. This is a service
account that never logs in, so it needs no home at all.

Clone into it. A deploy key or a personal access token is the usual way to read a private
repository from a server:

```bash
sudo -u kalendhair git clone https://github.com/ggrl/kalendhair.git /srv/kalendhair
cd /srv/kalendhair
```

That user must be in the `docker` group to run compose, or you prefix every compose command
with `sudo` instead:

```bash
sudo usermod -aG docker kalendhair
```

**The `docker` group is root on the host**, because anybody in it can start a container that
mounts `/`. It is an acceptable trade here only because this account has `nologin` and
nothing else runs as it. If that stops being true, drop the group and use `sudo docker
compose` throughout.

---

## Step 5: write the `.env` file

This is the step with the most ways to go quietly wrong. The server refuses to start
without any of the required names and tells you which one is missing, so a mistake here is
loud rather than silent. That is deliberate.

```bash
sudo -u kalendhair cp /srv/kalendhair/.env.example /srv/kalendhair/.env
sudo chmod 600 /srv/kalendhair/.env
```

**Lock it before you fill it, not after.** `cp` creates the file world-readable, and the
window that matters is the one where it has secrets in it. Doing the `chmod` now means
there is no such window.

Generate the machine secrets. **Never type these by hand and never reuse one from another
machine:**

```bash
openssl rand -hex 24     # POSTGRES_PASSWORD
openssl rand -base64 24  # SESSION_SECRET
openssl rand -base64 24  # MASTER_PASSWORD
```

**Why `-hex` for the database password and `-base64` for the others.** `DATABASE_URL`
embeds the password inside a URL. Base64 output can contain `+`, `/` and `=`, which have
meaning inside a URL and will either break the connection string or, worse, parse into
something that is not the password you set: a password ending `@evil.example.com/` would
send the username and a fragment of the password to somebody else's host on every boot.
Hex output cannot do either. `SESSION_SECRET` and `MASTER_PASSWORD` are never put in a URL,
so base64 is fine for them, and `openssl rand -base64 24` produces exactly the 32
characters `server/config.ts` demands as its minimum.

### Put single quotes around any value you chose yourself

**This one is silent, and it will lock the salon out of its own board.**

Compose expands `$` inside `.env` values. Node, which is how this server has always been
run outside a container, does not. So the same file means two different things:

| `.env` line | Compose delivers | Node delivers |
| --- | --- | --- |
| `SALON_PASSWORD=Sommer2026$Salon` | `Sommer2026` | `Sommer2026$Salon` |
| `SALON_PASSWORD='Sommer2026$Salon'` | `Sommer2026$Salon` | `Sommer2026$Salon` |

Nothing stops you. `Sommer2026` is longer than eight characters, so the server accepts it,
seeds it, and prints `salon password and PIN seeded from the environment` - the exact line
step 7 tells you confirms a correct start. The salon then types the password it chose and
is refused forever. Editing `.env` afterwards fixes nothing, because ADR-0017 makes the
seed a one-time act: the row exists now. And `MASTER_PASSWORD`, the documented way back in,
is truncated by the same rule if it also contains a `$`.

**And `$` is not the only character they disagree about.** Measured through both loaders:

| `.env` line | Compose delivers | Node delivers |
| --- | --- | --- |
| `X=pass#word` | `pass#word` | **`pass`** |
| `X='pass#word'` | `pass#word` | `pass#word` |
| `X="Sommer2026$Salon"` | **`Sommer2026`** | `Sommer2026$Salon` |

So `#` breaks it in the **opposite** direction from `$`, and **double quotes do not protect
you** - they leave compose expanding exactly as if they were not there.

**So: single-quote every value a person chose, whatever is in it.** Not because of `$`
specifically, but because you should not have to know which characters two parsers disagree
about. In practice that is `SALON_PASSWORD`:

```
SALON_PASSWORD='dein$Passwort'
```

Three things that are not the rule:

- **Not double quotes.** They are not equivalent and they fail silently.
- **Not `$$`.** Compose reads that correctly and Node hands you a literal `$$`.
- **Not an apostrophe in the value.** `O'Brien2026` cannot be single-quoted, and compose
  then refuses the whole project with `unexpected character "'" in variable name "Brien2026'"`.
  That one is loud, but read the message: **it echoes the rest of the password back onto
  stderr**, and on a cron run that lands in a log. Choose a password without an apostrophe.

The generated secrets above are hex and base64, neither of which can contain any of these,
so they are safe either way. Quoting them anyway costs nothing and is the simpler rule.

Now edit it. It is `600` and owned by `kalendhair`, so your own account cannot open it -
use `sudo`:

```bash
sudo -e /srv/kalendhair/.env      # or: sudo nano /srv/kalendhair/.env
```

Set every value:

| Name | What to put | Notes |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | the hex string | compose reads this directly, and refuses to start without it |
| `DATABASE_URL` | leave the example value | **compose overrides it.** See below |
| `TEST_DATABASE_URL` | leave the example value | development only, never read in this deployment |
| `SALON_TIMEZONE` | `Europe/Berlin` | ADR-0007. Never left to the server's clock |
| `HOST` | leave it | **compose overrides it** to `0.0.0.0`. See below |
| `PORT` | `3000` | must match the port compose publishes |
| `SESSION_SECRET` | a base64 string | minimum 32 characters, enforced |
| `MASTER_PASSWORD` | a base64 string | the way back in if password and PIN are both lost |
| `SALON_PASSWORD` | one the salon will type | at least 8 characters |
| `SALON_PIN` | four digits | guards the settings screen |
| `COOKIE_SECURE` | **`true`** | see the warning below |
| `TRUST_PROXY` | **`1`** | one proxy, Caddy, in front. See below |

**Two names in that file are deliberately overridden by `docker-compose.yml`**, because
`.env` is written for running the server on the host and both values are wrong from inside
a container:

- **`DATABASE_URL`** becomes `postgres://salon:...@db:5432/salon`. On the compose network
  Postgres answers to its service name, `db`. The `127.0.0.1` in `.env` would be the app
  container talking to itself.
- **`HOST`** becomes `0.0.0.0`. Inside a container `127.0.0.1` means "this container only",
  so the published port would reach nothing. What keeps the server off the network is the
  compose file publishing to `127.0.0.1:3000` **on the host**, not this value.

You still set `POSTGRES_PASSWORD` correctly, because compose builds the real
`DATABASE_URL` from it.

**Set `COOKIE_SECURE=true`, but understand what it is doing here.** When this value is
absent the server guesses from `HOST`: loopback means "no TLS in front of me", anything else
means "assume HTTPS". In **this** deployment compose sets `HOST` to `0.0.0.0`, so the guess
already lands on `Secure` and the cookie is marked correctly whether or not you set the
name. Verified: a container started with no `COOKIE_SECURE` at all logs
`session cookie: Secure`.

So this is belt and braces rather than the thing that saves you, and it is worth setting for
one reason: the day somebody changes `HOST` back to `127.0.0.1` - to put the app back on the
host, or to bind it differently - the guess silently flips and the session cookie starts
travelling in clear text on any plain HTTP request to the same hostname. Setting it
explicitly means that change cannot quietly downgrade the cookie.

**It follows that the startup log cannot detect a `COOKIE_SECURE` mistake in this
deployment**, because it prints `Secure` either way. The real check is step 9: log in
through the browser over HTTPS.

**`TRUST_PROXY=1` is the other half of the same day.** Set it here, on the server, because
this is the deployment that has a proxy - it is `1` because there is exactly one hop, Caddy,
between the internet and the app. Leave it out of a laptop's `.env`, where nothing is in
front and trusting a hop would let any caller name themselves. It takes a hop count and
refuses `true` by name: `true` trusts the whole `X-Forwarded-For` chain, which hands the
caller their own address and removes the three rate limits rather than fixing them.

Confirm the permissions stuck, now that the file holds every secret on the machine:

```bash
sudo chown kalendhair:kalendhair /srv/kalendhair/.env
ls -l /srv/kalendhair/.env      # must be -rw------- kalendhair kalendhair
```

`.env` is gitignored and must never be committed. See `rules/secrets.md`. If one of these
values ever reaches version control it is burned and has to be replaced, because history is
permanent.

**Three ordinary debugging commands print every one of these secrets in plain text**, and
they are exactly what you reach for when something is wrong: `docker compose config`,
`docker inspect` on the app container, and `docker compose exec app env`. Never paste their
output into an issue, a chat or a screenshot.

---

## Step 6: bring the whole stack up

One command builds the image, starts Postgres, waits for it to report healthy, then starts
the server:

```bash
cd /srv/kalendhair
sudo -u kalendhair docker compose up -d --build
sudo -u kalendhair docker compose ps
```

Note there is no `-f docker-compose.dev.yml` here, and there must not be. That override
exists only for a development machine: it publishes the database port the host-side test
suite needs, and creates the `salon_test` database. Neither belongs on the salon's server.

The database lives in a named Docker volume called `db-data`, which survives
`docker compose down` but **not** `docker compose down -v`. Learn the difference now rather
than at 19:00 on a Friday.

---

## Step 7: read the startup log before you go any further

```bash
sudo -u kalendhair docker compose logs -f app
```

**Five things to confirm**, and this output is exactly what a correct first run looks like:

```
migrate: applied 001_init.sql
migrate: applied 002_appointment_version.sql
migrate: applied 003_block_reason.sql
migrate: applied 004_salon_credential.sql
migrate: applied 005_core_hours.sql
salon password and PIN seeded from the environment
salon calendar api on http://0.0.0.0:3000
salon timezone: Europe/Berlin
session cookie: Secure - browsers will send it over HTTPS only
WARNING: if nothing in front of this terminates TLS, no login will work at all
rate limits: trusting 1 proxy hop(s) for the caller's address
WARNING: if nothing in front of this is a proxy, a caller can pick their own address
```

- **The `migrate:` lines.** They appear once, against a fresh database. On later starts
  there are none, because every migration has already run.
- **`seeded from the environment`** on a first run only. On later runs it says
  `SALON_PASSWORD and SALON_PIN are ignored` instead, which is ADR-0017 working correctly
  and not a fault.
- **`on http://0.0.0.0:3000`.** Inside a container that is right, and is not a leak.
  `0.0.0.0` here means "every interface *in this container*"; what limits reach is the
  compose file publishing the port to `127.0.0.1` on the host.
- **The cookie decision, stated out loud.** `session cookie: Secure` is what you want. The
  warning under it is correct and expected right now: the proxy does not exist yet. It is
  the next step.
- **The rate-limit decision, the same way.** `trusting 1 proxy hop(s)` is what you want, from
  the `TRUST_PROXY=1` in step 5. Its warning is correct and expected right now for the same
  reason as the cookie's: Caddy is the next step, and until it exists a caller reaching this
  port directly really could name themselves in a header. That is why step 2 closed everything
  except 22, 80 and 443 before this point. Both warnings stop being true once step 8 is done,
  and neither goes away - the server cannot see its own deployment, so it says what it assumed
  on every start.

Confirm the API and the board both answer, from the server itself:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/          # 200, the board
curl -i 'http://127.0.0.1:3000/api/day?date=2026-08-15' | head -1        # 401
```

A `401` with `{"error":"Bitte anmelden."}` is the **right** answer. ADR-0004 gives an
unauthenticated request no day at all rather than a filtered one.

There is no systemd unit to write. `restart: unless-stopped` in the compose file brings both
containers back after a crash and after a reboot, as long as Docker itself starts on boot,
which it does by default.

---

## Step 8: the reverse proxy and the TLS certificate

This is where HTTPS arrives. Caddy is the recommendation because it obtains and renews
certificates from Let's Encrypt automatically, with no cron job and no separate client to
configure. nginx with certbot is the alternative if you already know nginx.

Install Caddy from the project's own current instructions for your distribution, then
replace `/etc/caddy/Caddyfile` with:

```
board.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

That is the entire configuration. Reload it:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -f
```

On first start Caddy solves the challenge over port 80, obtains the certificate, redirects
all HTTP to HTTPS, and renews on its own thereafter. Watch the log until you see it
succeed. **If it fails, the cause is almost always one of two things**: the DNS record from
step 1 does not yet resolve to this machine, or port 80 is blocked by the cloud firewall
from step 2 rather than by `ufw`.

**If you prefer nginx:** proxy to `http://127.0.0.1:3000`, then run certbot's nginx plugin
to obtain the certificate and let it write the TLS block. Make sure the forwarding headers
are set, and read the next section either way.

---

## Step 9: before you call it done

**Open the board in a real browser at `https://board.example.com` and log in.** Not curl,
a browser. If the login screen accepts the password and then bounces you straight back to
it, the cause is the cookie, and there is only one way round it can be: `COOKIE_SECURE` is
`true` while the page is not actually on HTTPS, so the browser refuses to store a `Secure`
cookie and has nothing to send back. The reverse does not happen - a browser on an HTTPS
page accepts a cookie that is not marked `Secure` and returns it quite happily.

Then confirm the certificate is real, from your laptop rather than the server:

```bash
curl -I https://board.example.com
openssl s_client -connect board.example.com:443 -servername board.example.com </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer
```

And confirm the database is not reachable from outside, which is the check people skip:

```bash
nc -zv board.example.com 5432    # must fail. If it connects, stop and fix step 2
```

Finally, reboot the server once and confirm the board comes back on its own. A deployment
that has never survived a restart is untested, and unattended restarts are exactly when
nobody is watching.

---

## Step 10: backups, and the restore that has to actually happen

**`docs/PRODUCT_BRIEF.md` makes this a blocking condition, not a recommendation:** before
the salon puts one real appointment in, there must be a backup that leaves the machine on a
schedule, and one restore that has actually been performed rather than merely documented.
An untested backup is a belief, not a backup.

You can skip this for a throwaway test box with fake names. You cannot skip it for the real
one, and this is the gate between the two.

**Know what is in the file before you decide where to put it.** A dump of this database
holds every customer name, every treatment, and the `notes` field - which the code's own
comment identifies as where a salon writes "allergic to ammonia", meaning health data - plus
the `salon_credential` table of password hashes, which somebody can grind offline at their
leisure. It is not encrypted. Treat it as the most sensitive object on the machine, because
it is.

Make a directory for it that only this account can read:

```bash
sudo mkdir -p /srv/kalendhair-backups
sudo chown kalendhair:kalendhair /srv/kalendhair-backups
sudo chmod 700 /srv/kalendhair-backups
```

Then write the backup as a script rather than a one-liner, because it needs to fail loudly
and a pipeline does not do that by default. Write it to `/usr/local/bin/kalendhair-backup`,
**outside the git checkout** - a script kept inside `/srv/kalendhair` would be deleted by a
`git clean` and would collide the day the repository gains a file of that name, and backups
would then stop with no announcement.

Paste this whole block; it creates the file:

```bash
sudo tee /usr/local/bin/kalendhair-backup >/dev/null <<'SCRIPT'
#!/bin/bash
# Fail on error, on an unset name, and - the one that matters here - on any
# failing stage of a pipeline, not just the last one.
set -euo pipefail
umask 077

# cron does not get your login PATH, and docker is the thing it will not find.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

cd /srv/kalendhair
dest="/srv/kalendhair-backups/kalendhair-$(date +%F-%H%M).sql.gz"

# Write beside the real name, then move into place. A dump that dies halfway
# never gets the name a restore would reach for.
docker compose exec -T db pg_dump -U salon -d salon --clean --if-exists \
  | gzip > "$dest.part"
mv "$dest.part" "$dest"
SCRIPT

sudo chown root:root /usr/local/bin/kalendhair-backup
sudo chmod 755 /usr/local/bin/kalendhair-backup
sudo -u kalendhair /usr/local/bin/kalendhair-backup && echo "backup ok"
```

**Owned by `root`, run by `kalendhair`.** The account that runs it nightly cannot rewrite
it, which matters because that account is in the `docker` group: anything that compromised
the application would otherwise be able to edit a script that runs every night.

That last line is worth running rather than skipping. It executes the script exactly as cron
will - same account, same absent `HOME` - so if anything in the environment is wrong you find
out now rather than from a directory that quietly stopped filling.

**Three lines in that script are there because of specific ways this goes wrong**, and none
of them is theoretical:

- **`set -o pipefail`.** Without it the pipeline's exit status is `gzip`'s, and `gzip`
  succeeds at compressing nothing. Measured with the database stopped: exit `0`, a
  correctly named file, correct `600` permissions, a *valid* gzip archive - containing zero
  bytes. Cron mails nothing. You get a directory of plausible backups holding nothing at
  all, which is precisely the belief this section opens by warning about. **Note it must be
  `bash`, not `sh`:** on Debian and Ubuntu `/bin/sh` is dash, which answers `set -o
  pipefail` with `Illegal option`.
- **`umask 077`.** Without it the redirect creates the file `0644` under the default umask,
  readable by every account on the box. `/var/backups`, the obvious place to put it, is
  `0755 root:root` on Debian and Ubuntu.
- **`.part` then `mv`.** Belt and braces with `pipefail`: a half-written dump never carries
  the name a restore would reach for. A leftover `.part` is the trace of a failed run.

Measured, with the dump made to fail: exit `1`, no file carrying the final name, one
`.part` left behind. On success: exit `0`, mode `600`, real content.

Then run it from cron nightly, as the same account:

```bash
sudo crontab -u kalendhair -e
```

Add this line, **without a leading `#`**, and keep the redirect:

```
20 3 * * * umask 077; /usr/local/bin/kalendhair-backup >> /srv/kalendhair-backups/backup.log 2>&1
```

**The `umask 077;` at the front is not the same one as in the script.** Cron's own shell
creates `backup.log` *before* the script starts, so the script's umask cannot apply to it:
without this the log lands at `664`. Measured both ways. It matters because that log can
carry a compose parse error, and those echo part of the offending value.

Then confirm it is really there, because a crontab that saved as a comment looks exactly
like one that saved correctly:

```bash
sudo crontab -u kalendhair -l | grep kalendhair-backup   # must print a line NOT starting with #
```

### Nobody is listening unless you make them

`pipefail` makes the script exit non-zero, and cron's convention is to mail that to you. **A
stock cloud image has no mail transfer agent**, so on a default Ubuntu or Debian VM there is
nothing to deliver it: checked, and the mail spool stayed empty after a failing run. Saying
the script "fails loudly" is only half true - it fails *correctly*, into silence.

The redirect above is what gives the failure somewhere to sit, and the `umask 077` in front
of it is what keeps that log at `600` like the dumps. Three things to look at, and they take
one command:

```bash
sudo -u kalendhair ls -lt /srv/kalendhair-backups | head
```

- **The newest timestamp.** If it is not from last night, backups have stopped.
- **Any `.part` file.** One per failed run.
- **`backup.log`.** The error itself.

Put that in whatever routine you already have. If you would rather have mail, install an MTA
and set `MAILTO=` at the top of the crontab - but do not assume mail exists, because by
default it does not.

### Then get it off the machine, on the same schedule

**What you have so far is a nightly backup that dies with the disk it is on.** The brief's
condition is a backup that *leaves the machine* on a schedule, and nothing above does that
yet - so add the copy as the last line of `/usr/local/bin/kalendhair-backup`, not as
something you remember to do. `set -e` then makes a failed upload fail the whole run, which
is what you want:

```bash
# last line of the script, once you have chosen a destination
rclone copy "$dest" remote:kalendhair-backups   # or: scp "$dest" user@host:/backups/
```

The command is yours to choose because the destination is; the scheduling is not optional.

**Think hard about where.** This is the one instruction in this guide that can hand the
salon's data to the internet if you follow it carelessly. **The destination must be
private** - a storage bucket or container with public
access disabled, or a host you control reached over SSH. A bucket left world-readable is
the ordinary way this goes wrong, and the file is unencrypted, so anyone who finds it has
everything. If the destination is not one you would be comfortable posting the URL of,
encrypt the dump before it leaves.

**Then rehearse the restore, on a scratch database, before you need it:**

```bash
cd /srv/kalendhair

# 0. the backup directory is 700 and owned by kalendhair, so read it as kalendhair.
#    Every command below runs as that account, the gunzip included - see the note after.
sudo -u kalendhair ls -l /srv/kalendhair-backups

# 1. a dump of zero bytes is the failure this drill exists to catch. Check before restoring.
sudo -u kalendhair sh -c 'gunzip -c /srv/kalendhair-backups/kalendhair-SOMEDATE.sql.gz | wc -c'

# 2. restore it into a scratch database
sudo -u kalendhair docker compose exec -T db psql -U salon -d postgres -c 'CREATE DATABASE restore_drill;'
sudo -u kalendhair sh -c 'gunzip -c /srv/kalendhair-backups/kalendhair-SOMEDATE.sql.gz' \
  | sudo -u kalendhair docker compose exec -T db psql -U salon -d restore_drill

# 3. prove the data is really there
sudo -u kalendhair docker compose exec -T db psql -U salon -d restore_drill -c '\dt'
sudo -u kalendhair docker compose exec -T db psql -U salon -d restore_drill -c 'SELECT count(*) FROM appointment;'
sudo -u kalendhair docker compose exec -T db psql -U salon -d postgres -c 'DROP DATABASE restore_drill;'
```

**The `sudo -u kalendhair` on the `gunzip` is not redundant.** `/srv/kalendhair-backups` is
`700` and owned by that account, which is what keeps the dumps private - so reading them as
your own admin account fails with `Permission denied`, and the pipe then feeds an empty
stream into `psql`, which reports success on zero input. That is the same shape of false
confidence as an empty backup, arriving at the one moment you are trying to disprove it.
Step 1 above is the cheap guard: a byte count of `0` means the backup is worthless no
matter what the restore says.

If the table list and the count look right, you have a backup. Write the date you did this
in `WORK_LOG.md`, because the brief's condition is about a restore having happened, and
nobody will remember whether it did.

---

## Updating a running deployment

```bash
cd /srv/kalendhair
sudo -u kalendhair git pull
sudo -u kalendhair docker compose up -d --build
sudo -u kalendhair docker compose logs -n 50 app
```

`--build` is the part people forget. Without it compose reuses the existing image and you
have pulled new source that is not running, which looks exactly like the update having no
effect.

Migrations apply themselves on start, so there is no separate step. **Take a backup before
any update that includes a new migration**, because migrations here have no down path and
are not reversible.

There is a short outage while the app container is replaced. Postgres is untouched, so it is
seconds. For one salon that is acceptable; if it ever is not, that is a load balancer and a
second instance, which is a bigger change than this document covers.

To roll back, check out the previous commit and rebuild the same way. That reverses the
code and **not** the database, which is the reason the backup above comes first.

---

## Known gaps

Things this deployment does not solve, listed so they are decisions rather than surprises.

**The rate limiters depend on you setting `TRUST_PROXY` correctly**, and nothing can check it
for you. The server cannot see whether a proxy is really in front of it, so both this and
`COOKIE_SECURE` are claims you make about the deployment. If you set `TRUST_PROXY=1` on a box
where the app port is reachable directly, anything that can reach it picks its own address
and the limits stop applying. The compose file publishes to `127.0.0.1` precisely so that
"reachable directly" means "already on the host".

**The image is built on the server, not in CI.** Simple, and it means the box needs enough
memory to run a TypeScript build. Building in CI and pushing to a registry is the tidier end
state, and it would also let a deploy be a pull rather than a compile.

A failed **build** is safe: `docker compose up -d --build` builds before it converges, so
the running version is untouched. Measured by breaking the `Dockerfile` deliberately against
a running stack - the build failed, the old container stayed up, and the board still
answered 200.

**That safety stops at the build.** A commit that compiles and then fails at runtime - a
migration with a bad statement is the obvious one - is a real outage: compose has already
stopped the old container, the new one throws on startup, and `restart: unless-stopped`
crash-loops it. Compose does not put the old one back. Rolling back the code does not roll
back a migration that half-applied either, which is why the backup comes first.

**No health endpoint, so the app container has no healthcheck, and nothing here notices a
dead database.** There is no `/health`. Worse, there is no unauthenticated request that
touches Postgres at all: `GET /api/day` with no cookie returns 401 from
`session === null` before it ever queries, so it answers 401 just as cheerfully with the
database gone. Serving `/` is `express.static` and touches nothing either.

So an uptime monitor built on either of those proves the Node process is running and
nothing more. **The failure most worth paging for is the one it cannot see.** Until a real
health endpoint exists, the honest check is authenticated - log in and fetch a day - or
external, watching the `db` container rather than the API. A monitor that treats 401 as
failure will page you constantly, which is the wrong lesson to learn from this.

**No log rotation beyond Docker's defaults**, and no metrics. `docker compose logs` is the
whole observability story.

**One shared password, by design.** ADR-0004, with its costs written down. ADR-0004 also
marks itself to be revisited before an iOS app puts that password on phones that leave the
building.

**Secrets live in one `.env` file on the box.** Fine for one salon and one server. If this
ever becomes more than that, it becomes a secret manager.

---

## If something is wrong

| Symptom | First thing to check |
| --- | --- |
| Salon cannot log in with the password you set | An unquoted `$` in `.env`. Compose truncated it at the `$`, and ADR-0017 already seeded the short version. Fix `.env` with single quotes, then reset via `MASTER_PASSWORD` - editing `.env` alone will not help |
| `destination path already exists and is not an empty directory` at step 4 | `useradd --create-home` was used. The account needs no home. See step 4 |
| `Permission denied` on `cd /srv/kalendhair` | Same cause: the directory is `750` from `--create-home`. It should be `755` and owned by `kalendhair` |
| `set POSTGRES_PASSWORD in .env` before anything starts | Compose substitution, not the app. `.env` is missing or not in the directory you ran compose from |
| `... is required and was not set` in the app log | That name is missing from `.env`. The message names the one it wants |
| App container restarts in a loop | `docker compose logs app`. Usually the database URL or a missing secret. `depends_on` waits for healthy, so it is rarely a race |
| App cannot reach the database | `DATABASE_URL` must use host `db`, not `127.0.0.1`. Compose sets this; check you did not override it in `.env` |
| Login accepted, then bounced back to login | `COOKIE_SECURE` disagrees with whether the page is really on HTTPS. The startup log says which mode it chose |
| Caddy cannot get a certificate | DNS not resolving to this box yet, or port 80 blocked at the cloud firewall rather than at `ufw` |
| Everyone locked out of login at once | `TRUST_PROXY` is unset while Caddy is in front, so every caller shares one budget. The startup log says which way it went |
| One caller never gets rate limited | `TRUST_PROXY` is set where nothing proxies this, so they are picking their own address in a header |
| Update seems to do nothing | `--build` was omitted, so compose reused the old image |
| Board works, then dies after a reboot | Docker is not enabled at boot. `restart: unless-stopped` cannot help if the daemon never starts |
| Password in `.env` does not work | Expected after first run. ADR-0017: the environment seeds once, then the settings screen owns it. Use `MASTER_PASSWORD` to reset |
| `docker compose config` printed all my secrets | It renders `.env` in plain text by design. Never paste that output into an issue or a chat |
