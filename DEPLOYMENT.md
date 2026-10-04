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
sudo useradd --system --no-create-home --home-dir /var/lib/kalendhair --shell /usr/sbin/nologin kalendhair
sudo install -d -m 700 -o kalendhair -g kalendhair /var/lib/kalendhair
sudo mkdir -p /srv/kalendhair
sudo chown kalendhair:kalendhair /srv/kalendhair
sudo chmod 755 /srv/kalendhair
```

**`--no-create-home` and the explicit `chmod` are both deliberate.** With
`--create-home --home-dir /srv/kalendhair` the directory arrives holding a copy of
`/etc/skel`, and `git clone` then refuses it: `destination path already exists and is not
an empty directory`. That home would also be mode `750`, which makes every `cd
/srv/kalendhair` later in this guide fail for your own admin account.

**But the account does need a home, just not that one.** `sudo -u kalendhair` sets `HOME` to
the account's home, and `docker compose up --build` writes there. Without the `install` line
`useradd` still records `/home/kalendhair`, nothing creates it, and step 6 stops with
`mkdir /home/kalendhair: permission denied` - met on the first real deployment, 2026-10-04.

**Run git as the owner too.** As root, `git log` in `/srv/kalendhair` stops with `detected
dubious ownership`. Use `sudo -u kalendhair git -C /srv/kalendhair ...` rather than adding the
`safe.directory` exception it suggests.

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

**Six things to confirm**, and this output is exactly what a correct first run looks like:

```
migrate: applied 001_init.sql
migrate: applied 002_appointment_version.sql
migrate: applied 003_block_reason.sql
migrate: applied 004_salon_credential.sql
migrate: applied 005_core_hours.sql
salon password and PIN seeded from the environment
retention: deleted 0 appointment(s) and block(s) older than a year
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
- **`retention: deleted 0`** on every start, and again once a day while it runs. Zero is right
  until the board has appointments more than a year old. A count and never a name: ADR-0027.
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

**The shape, decided in [ADR-0028](docs/adr/ADR-0028-the-backup-is-encrypted-and-pulled-by-the-salon-laptop.md):**
the server dumps the database every night and encrypts it to a key it cannot decrypt with.
The salon's Windows laptop fetches the dumps once a day through a login that can read them
and do nothing else. Each side keeps the newest seven. Nobody is alerted when it stops: the
check is a person looking at the laptop's folder, so **that look is part of the backup**.

**Know what is in the file.** A dump of this database holds every customer name, every
treatment, and the `notes` field - which the code's own comment identifies as where a salon
writes "allergic to ammonia", meaning health data - plus the `salon_credential` table of
password hashes, which somebody can grind offline at their leisure. That is why it is
encrypted before it is written, and why the server holds only the public half of the key.

### 10a. Make the key, on your own computer - not the server

Any machine with [`age`](https://github.com/FiloSottile/age) installed will do:

```bash
age-keygen -o kalendhair-backup.key
```

It prints `Public key: age1...`. **Put the whole content of `kalendhair-backup.key` into your
password manager, then delete the file** - permanently, not to the Trash or the Recycle Bin,
where it is still a file. That file is the only thing that can read a
backup. Lose it and every dump is noise; leave it on the server and whoever breaks in reads
them all. The public key is not a secret and is what the server gets.

The password manager needs two more things before this is finished, because the backup does
not contain them and a new server cannot start without them: **every value in `.env`**, and
the salon password and PIN as they are now (ADR-0017 - they live in the database, and the
database is what you are restoring, but the master password is only in `.env`).

### 10b. The nightly dump on the server

Install `age` and give the server the public key. Replace the placeholder with the
`age1...` line from 10a:

```bash
sudo apt update
sudo apt install -y age
echo 'PASTE-YOUR-PUBLIC-KEY-HERE' | sudo tee /etc/kalendhair-backup.pub >/dev/null
```

`age` is in Debian's and Ubuntu's own archives: checked on Debian 12 and 13 and Ubuntu 22.04
and 24.04, versions 1.0.0 to 1.2.1. A dump written by 1.1.1 decrypts with 1.3.2 and the
other way around - tested, because a key made on a newer laptop is the normal case.

Then the directories:

```bash
sudo groupadd --system kalendhair-backup
sudo mkdir -p /srv/kalendhair-backups/files
sudo chown root:root /srv/kalendhair-backups
sudo chmod 755 /srv/kalendhair-backups
sudo chown kalendhair:kalendhair-backup /srv/kalendhair-backups/files
sudo chmod 2750 /srv/kalendhair-backups/files
sudo install -o kalendhair -g kalendhair -m 600 /dev/null /var/log/kalendhair-backup.log
```

**Each of those modes is load-bearing.**

- `/srv/kalendhair-backups` is root's and not writable by anyone else, because OpenSSH
  refuses to lock a login inside a directory that is not. That is the laptop's jail, 10c.
- `files` is `2750`: the `kalendhair` account writes, the `kalendhair-backup` group reads,
  nobody else gets in. The `2` makes every new file inherit that group, which is how the
  laptop's login can read a file it did not create.
- The log lives outside, in `/var/log`, created `600` up front. It can carry a compose error
  that echoes part of a value from `.env`, and the laptop has no business reading it.

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
# Readable by the kalendhair-backup group, which is how the laptop's login reads
# them. They are encrypted, so readable is not the same as legible.
umask 027

# cron does not get your login PATH, and docker is the thing it will not find.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

cd /srv/kalendhair
dir=/srv/kalendhair-backups/files
dest="$dir/kalendhair-$(date +%F-%H%M).sql.gz.age"

# Encrypted to the public key only. This machine cannot read its own backups,
# so neither can anybody who breaks into it.
#
# Written beside the real name, then moved into place. A dump that dies halfway
# never gets the name a restore - or the laptop - would reach for.
docker compose exec -T db pg_dump -U salon -d salon --clean --if-exists \
  | gzip | age -R /etc/kalendhair-backup.pub > "$dest.part"
mv "$dest.part" "$dest"

# Keep the newest seven. Reached only when the new dump is in place, so a run
# that fails deletes nothing, and a week of failures still leaves the last
# seven good ones. The names sort by date because they start with it.
ls -1 "$dir"/kalendhair-*.sql.gz.age | head -n -7 | xargs -r rm --

# A .part is a night that failed partway. It can hold whole chunks of real rows,
# so it goes too, once a night has succeeded.
rm -f "$dir"/*.part
SCRIPT

sudo chown root:root /usr/local/bin/kalendhair-backup
sudo chmod 755 /usr/local/bin/kalendhair-backup
sudo -u kalendhair /usr/local/bin/kalendhair-backup && echo "backup ok"
```

**Owned by `root`, run by `kalendhair`.** The account that runs it nightly cannot rewrite
it, which matters because that account is in the `docker` group: anything that compromised
the application would otherwise be able to edit a script that runs every night.

That last line is worth running rather than skipping. It executes the script exactly as cron
will - same account, same `HOME` - so if anything in the environment is wrong you find
out now rather than from a directory that quietly stopped filling.

**The lines in that script that exist because of a specific way this goes wrong**, none of
them theoretical:

- **`set -o pipefail`.** Without it the pipeline's exit status is the last stage's, and the
  last stage succeeds at encrypting nothing. Measured before encryption was added, with the
  database stopped: exit `0`, a correctly named, *valid* gzip archive containing zero bytes.
  **It must be `bash`, not `sh`:** on Debian and Ubuntu `/bin/sh` is dash, which answers
  `set -o pipefail` with `Illegal option`.
- **`.part` then `mv`.** A half-written dump never carries the name the laptop fetches -
  it fetches `*.age`, and `.part` does not match. A `.part` that is still there is the
  trace of a night that failed since the last good one.
- **The prune comes last.** Measured with the dump made to fail: exit `1`, the seven
  finished backups untouched, one `.part` left behind - and gone after the next good night,
  because a cut-off dump still holds whole chunks of real rows, and ADR-0027's year would
  not otherwise apply to it. Deleting by age instead - "anything
  older than seven days" - would have spent a week of silent failures deleting the last good
  backup.

Measured the other way: with nine older backups in place, one run left exactly seven, the
new one among them. Mode `640`, group `kalendhair-backup`.

Then run it from cron nightly, as the same account:

```bash
sudo crontab -u kalendhair -e
```

Add this line, **without a leading `#`**, and keep the redirect:

```
20 3 * * * umask 077; /usr/local/bin/kalendhair-backup >> /var/log/kalendhair-backup.log 2>&1
```

**The `umask 077;` at the front is not the same one as in the script.** Cron's own shell
opens the log *before* the script starts, so the script's umask cannot apply to it. The file
already exists at `600`, so this only matters the day somebody deletes it - and then it is
the difference between `600` and `664`.

Then confirm it is really there, because a crontab that saved as a comment looks exactly
like one that saved correctly:

```bash
sudo crontab -u kalendhair -l | grep kalendhair-backup   # must print a line NOT starting with #
```

### 10c. A login for the laptop that can only read

Make the account, give it the laptop's public key - from 10d, step 2, so do that first - and
lock it in:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin -g kalendhair-backup kalendhair-pull
echo 'PASTE-THE-LAPTOP-PUBLIC-KEY-HERE' | sudo tee /etc/ssh/kalendhair-pull.keys >/dev/null
sudo tee /etc/ssh/sshd_config.d/kalendhair-pull.conf >/dev/null <<'CONF'
# The laptop's login: read the backups, and nothing else. No shell, no
# forwarding, no writing - it cannot delete a backup or leave anything behind.
Match User kalendhair-pull
    AuthorizedKeysFile /etc/ssh/kalendhair-pull.keys
    AuthenticationMethods publickey
    ChrootDirectory /srv/kalendhair-backups
    ForceCommand internal-sftp -R -d /files
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
CONF
sudo sshd -t && sudo systemctl reload ssh
```

**What that login was measured to do**, from outside, against a Debian 12 server set up with
exactly these blocks: `get` of every backup works. `put`, `rm`, `rename` and `mkdir` all
answer `Permission denied`, including a `put` over an existing backup. `ls /` shows `/files`
and nothing else, and `/etc/passwd` is `not found`. A shell gets `This service allows sftp
connections only.` A port forward gets `administratively prohibited`. A password gets
`Permission denied (publickey)`. And `sshd -T` confirms the `Match` block binds this account
only: `root` and `kalendhair` keep their settings.

**A stolen laptop key can therefore read seven encrypted files and nothing else.** Remove its
line from `/etc/ssh/kalendhair-pull.keys` and it cannot do even that.

The reload's exit code proves nothing about the new rules. The first connection in 10d, step
3, does.

### 10d. The laptop

Everything below runs in **PowerShell on the salon's Windows laptop**, as the person who uses
it. Nothing needs to be installed, if the SSH client that ships with Windows is there.

**1. Check for the SSH client.**

```powershell
where.exe ssh
```

`where.exe`, not `where`: in PowerShell `where` means something else and answers nothing
useful. If it finds nothing, install it from Settings > System > Optional features >
"OpenSSH Client", or as administrator with
`Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0`. Microsoft's own pages
disagree about whether it is there by default, which is why this step exists.

**2. Make the laptop's key.** Press Enter twice when it asks for a passphrase: a key nobody is
there to unlock has to have none, which is why 10c gives it so little to unlock.

```powershell
ssh-keygen -t ed25519 -f "$HOME\.ssh\kalendhair-pull" -C "kalendhair laptop"
Get-Content "$HOME\.ssh\kalendhair-pull.pub"
```

That last line prints the public key. It is what goes into 10c.

**3. Meet the server once, by hand.** The first connection asks whether to trust the server's
identity, and a scheduled run cannot answer - it fails with `Host key verification failed`,
which is exactly what happened when this was first tested.

```powershell
sftp -i "$HOME\.ssh\kalendhair-pull" kalendhair-pull@YOUR-SERVER-NAME
```

Before answering `yes`, compare the fingerprint it shows with the one of the same type -
`ED25519`, `ECDSA` or `RSA`, it says which - among those the server prints for
`for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done`. An older Windows SSH
client may be offered a different type than a newer one. Then `ls` should list the backups, and
`bye` leaves.

**4. The script.** Make the folder and save this as `pull.ps1` in it:

```powershell
New-Item -ItemType Directory -Force "$HOME\kalendhair-backups"
notepad "$HOME\kalendhair-backups\pull.ps1"
```

Paste this, and change `YOUR-SERVER-NAME` in the fourth line:

```powershell
# kalendhair: fetch the encrypted backups from the server and keep a week of them.
# Run daily by Task Scheduler. Every run writes one line to pull.log, success or not.
param(
    [string]$Server = 'kalendhair-pull@YOUR-SERVER-NAME',
    [string]$Key    = "$HOME\.ssh\kalendhair-pull",
    [string]$Folder = "$HOME\kalendhair-backups"
)
$ErrorActionPreference = 'Stop'
$log      = Join-Path $Folder 'pull.log'
$incoming = Join-Path $Folder 'incoming'
$batch    = Join-Path $Folder 'pull.sftp'

try {
    # First the list, and only names of the exact shape the server script writes.
    # The server chooses the names, and a name is also where sftp writes on this
    # laptop - so nothing else, no path, no backslash, no wildcard, reaches a get.
    Set-Content -Path $batch -Value 'ls -1'
    # BatchMode: fail instead of waiting for a password nobody will type.
    $listing = & sftp -q -b $batch -i $Key -o BatchMode=yes $Server
    if ($LASTEXITCODE -ne 0) { throw "sftp exited with $LASTEXITCODE while listing" }
    $offered = @($listing | ForEach-Object { $_.Trim() } |
        Where-Object { $_ -cmatch '^kalendhair-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\.sql\.gz\.age$' })
    if ($offered.Count -eq 0) { throw 'the server offered no backups' }

    # Only names this laptop does not have yet. A copy that is here stays exactly
    # as it arrived, whatever the server offers under the same name later.
    $new = @($offered | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Folder $_)) })
    if ($new.Count -gt 0) {
        # Into a folder of its own first, so a transfer that dies halfway never
        # sits beside the good copies under a good copy's name.
        if (Test-Path $incoming) { Remove-Item $incoming -Recurse -Force }
        New-Item -ItemType Directory -Path $incoming | Out-Null
        Set-Content -Path $batch -Value ($new | ForEach-Object { "get $_ $_" })
        Push-Location $incoming
        try {
            & sftp -q -b $batch -i $Key -o BatchMode=yes $Server
            if ($LASTEXITCODE -ne 0) { throw "sftp exited with $LASTEXITCODE while downloading" }
        } finally {
            Pop-Location
        }
        Get-ChildItem -Path $incoming | Move-Item -Destination $Folder
        Remove-Item $incoming -Recurse -Force
    }

    # A copy goes only once seven newer ones have arrived AND it arrived more than
    # seven days ago, by this laptop's clock. Not by name: the server chooses the
    # names. A server that stops sending new dumps therefore leaves the last seven
    # here for good, and junk cannot push a copy out inside a week of its arrival.
    Get-ChildItem -Path $Folder -Filter 'kalendhair-*.age' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 7 |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
        Remove-Item

    $newest = $offered | Sort-Object | Select-Object -Last 1
    Add-Content -Path $log -Value "$(Get-Date -Format s) ok, $($new.Count) new, newest $newest"
} catch {
    Add-Content -Path $log -Value "$(Get-Date -Format s) FAILED: $_"
    exit 1
}
```

Run it once by hand:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\kalendhair-backups\pull.ps1"
Get-Content "$HOME\kalendhair-backups\pull.log" -Tail 1
```

It should say `ok, 7 new, newest kalendhair-...` - or fewer new, once it has run before - and
the folder should hold the backups.

**It trusts the server as little as it can, and this is exactly how far that goes:**

- **A name is only ever one of the server script's own.** The script asks for the list
  first and takes only `kalendhair-YYYY-MM-DD-HHMM.sql.gz.age`, digits 0-9, lower case, and
  fetches each by that exact name. The server chooses the names, and a name is also where
  sftp writes on the laptop, so a path, a backslash or a wildcard never reaches a download.
- **A copy here is never overwritten.** A name the laptop already has is not fetched again.
- **A copy is kept at least seven days after it arrived**, by the laptop's own clock, and
  after that for as long as fewer than seven newer copies have arrived. So a server that
  stops sending leaves the last seven here for good.
- **A server that has been taken over can still replace them.** Copies older than a week,
  in one run of seven new files - after a holiday with the laptop off, say. Fresher copies,
  in about a week of one plausible file a night. Those files would even decrypt: the server
  holds the public key and can encrypt fake dumps. Nothing a look at the folder shows gives
  it away. Only a restore does, which is one more reason 10f is not a one-off.
- **It can also make every run fail**, by listing a name it will not serve. That is loud -
  `FAILED` in `pull.log`, nothing deleted - which is the better way for this to go wrong.

**What this script was measured to do**, in PowerShell 7 on Linux against the test server,
not on Windows, with seven distinct encrypted files:

- With `KALENDHAIR-...` in capitals, `kalendhair-[x]...`, a date containing the Arabic-Indic
  digit `٣`, a `.part`, `x.age` and `..\kalendhair-...` on the server, only the seven
  well-formed names arrived, and nothing was written beside the folder.
- A server file dated 2020 arrived stamped with the time it arrived.
- With the laptop's copies made to look ten days old and nothing new on the server, the next
  run kept all seven.
- With the server's seven overwritten by junk under the same names, the next run took
  nothing and the copies here stayed byte for byte the same.
- Seven junk files named for 2099 were taken in and the real seven kept beside them. Once
  those had arrived more than seven days before, the next good run let them go - the limit
  above. A failed run in between deleted nothing.
- With the server unreachable it exited `1`, logged `FAILED`, and deleted nothing. A file of
  your own in the folder is left alone.

**One thing the test did not explain:** several runs ended with exit code `133` or `134`
from the emulated PowerShell - mostly after writing a correct `ok` line, once after
downloading but before logging, which the next run then counted correctly as nothing new.
Whether that is the emulator or something the script does was not settled. On Windows,
step 6 below and Task Scheduler's "Last Run Result" are where it would show. **Windows PowerShell 5.1, which is what a laptop runs, was not available to test** -
which is why running it by hand once, above, is not optional.

**5. Schedule it.** Daily at noon, and at every logon, so a laptop that was switched off at
noon still gets its copy the next time somebody signs in:

```powershell
$script = "$HOME\kalendhair-backups\pull.ps1"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$triggers = @(
    New-ScheduledTaskTrigger -Daily -At 12:00
    New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'kalendhair backup' -Action $action -Trigger $triggers -Settings $settings
```

**Why each setting:**

- **Only while you are logged on.** No `-User` or `-Password`, so Task Scheduler should show
  the task as "Run only when user is logged on" - check that it does. Running while logged
  off would mean storing your Windows password in the task, where the next password change
  silently breaks it. The laptop is in use whenever the salon is open, which is the only
  time this needs to run.
- **`-StartWhenAvailable`** catches up a noon that was missed. Microsoft's documentation
  does not say whether that covers a laptop that was switched off rather than asleep, which
  is why the logon trigger is there as well. Running twice in a day costs nothing.
- **`-AllowStartIfOnBatteries`**, because Microsoft documents it as a switch you turn on, and
  this is a laptop.
- **Ten minutes**, instead of the default three days, so a hung connection ends.

**6. Prove it runs on its own.** Two checks that only this laptop can answer:

```powershell
Start-ScheduledTask -TaskName 'kalendhair backup'
Start-Sleep 30
Get-Content "$HOME\kalendhair-backups\pull.log" -Tail 1
```

Then sign out and back in, and look at the log again: a new line proves the logon trigger.
If either shows nothing, Task Scheduler's own "Last Run Result" for the task is the next
place to look.

### 10e. The check

**Nothing tells anyone when a backup fails.** A stock cloud server has no mail system -
checked, the mail spool stayed empty after a failing run - and no alerting service was
chosen, by decision. So somebody looks, regularly, at the laptop's
`kalendhair-backups` folder:

- **The newest file's name should carry yesterday's or today's date.** The time in the name
  is the server's clock, which `timedatectl` on the server names - it need not be German
  time. If the newest is days old, one side has stopped.
- **The last line of `pull.log`** says whether the laptop's side worked, and why not.
- **On the server**, `sudo -u kalendhair ls -l /srv/kalendhair-backups/files` and
  `sudo tail /var/log/kalendhair-backup.log` say whether the server's side did. A `.part`
  file is one failed night.

With a week kept on each side, a failure noticed within that week has lost nothing that
existed. The laptop usually holds seven or eight files; the count is not the thing to watch,
the dates are.

### 10f. Rehearse the restore, from a copy that went through the laptop

**This is the step the brief is about.** Do it before the first real appointment, and write
the date in `WORK_LOG.md`, because nobody will remember whether it happened.

Carry one backup from the laptop's `kalendhair-backups` folder to the computer you administer
the server from - a USB stick is fine, it is encrypted - and send it up from there:

```bash
scp kalendhair-SOMEDATE.sql.gz.age YOUR-ADMIN-USER@YOUR-SERVER-NAME:/tmp/
```

Not from the laptop directly: its only key is the one that can read backups, and the server
will not let it log in as you.

On the server, put the private key from your password manager into a file only you can
read, then restore into a scratch database:

```bash
cd /srv/kalendhair
install -m 600 /dev/null ~/restore.key
nano ~/restore.key    # paste the whole key, save

# 1. a dump of zero bytes is the failure this drill exists to catch. Check before restoring.
age -d -i ~/restore.key /tmp/kalendhair-SOMEDATE.sql.gz.age | gunzip | wc -c

# 2. restore it into a scratch database
sudo -u kalendhair docker compose exec -T db psql -U salon -d postgres -c 'CREATE DATABASE restore_drill;'
age -d -i ~/restore.key /tmp/kalendhair-SOMEDATE.sql.gz.age | gunzip \
  | sudo -u kalendhair docker compose exec -T db psql -v ON_ERROR_STOP=1 -U salon -d restore_drill

# 3. prove the data is really there, and matches
sudo -u kalendhair docker compose exec -T db psql -U salon -d restore_drill -c 'SELECT count(*) FROM appointment;'
sudo -u kalendhair docker compose exec -T db psql -U salon -d salon -c 'SELECT count(*) FROM appointment;'
sudo -u kalendhair docker compose exec -T db psql -U salon -d postgres -c 'DROP DATABASE restore_drill;'

# 4. the key does not stay. The .save is what nano leaves if the connection dropped.
rm -f ~/restore.key ~/restore.key.save /tmp/kalendhair-SOMEDATE.sql.gz.age
```

**`ON_ERROR_STOP=1` is the difference between a restore and a belief.** Without it `psql`
carries on past a failing statement and exits `0` at the end. **And step 1 is the cheap
guard:** a byte count of `0` means the backup is worthless no matter what the restore says.

The two counts should differ by no more than what was booked since the dump was taken.

Tested on a development machine, not a server: a real dump of 42 appointments, 6 staff, the
core hours and the credential row went through `pg_dump`, `gzip` and `age` to a 4.5 KB file
with no readable text in it, and came back out of a scratch database identical in every
count.

**The real thing, the day it is needed**, is the same pipe into `salon` instead of
`restore_drill`, with the app stopped so nothing writes halfway:

```bash
sudo -u kalendhair docker compose stop app
age -d -i ~/restore.key /tmp/kalendhair-SOMEDATE.sql.gz.age | gunzip \
  | sudo -u kalendhair docker compose exec -T db psql -v ON_ERROR_STOP=1 -U salon -d salon
sudo -u kalendhair docker compose start app
rm -f ~/restore.key ~/restore.key.save /tmp/kalendhair-SOMEDATE.sql.gz.age
```

The key comes off the server again the moment the restore is done. **After a break-in, do
not restore onto the machine that was broken into:** pasting the key there hands it to
whoever is still in it, and deleting it afterwards does not take it back. Build a new server
with steps 0 to 9 and restore there.

The dump is taken with `--clean --if-exists`, so it replaces what is there rather than
colliding with it. Restoring a dump over the database it came from, on a development
machine, gave back the same 42 appointments with the same checksum over every id, name and
note. On a new server, do steps 0 to 9 first; the migrations the server runs on start are
harmless, because the dump then replaces every table.

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
| `destination path already exists and is not an empty directory` at step 4 | `useradd --create-home` was used. The home belongs in `/var/lib/kalendhair`, not the checkout. See step 4 |
| `mkdir /home/kalendhair: permission denied` at step 6 | The account has no home directory. Run step 4's `install -d` line, then `sudo usermod -d /var/lib/kalendhair kalendhair` |
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
