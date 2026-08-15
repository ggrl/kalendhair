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

**2. `trust proxy` is not set, and that matters the moment a proxy exists.** `server/app.ts`
rate limits login to twenty attempts per address per five minutes. Behind a reverse proxy
that Express has not been told to trust, every request appears to come from the proxy, so
the limit stops being per-visitor and becomes one budget shared by everybody. The code
comment states the consequence plainly: a stranger can then hold the salon's door shut at
four requests a minute. **This is a code change that has to happen before real use.** See
[Known gaps](#known-gaps) at the end. It does not block a throwaway test box.

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

Firewall first, then services. The opposite order leaves a window where Postgres is
listening and unprotected.

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
reach it from anywhere. The loopback publish that local development needs lives in
`docker-compose.dev.yml`, a file the server never loads.

---

## Step 3: install Docker

Docker is the only runtime dependency. **You do not need Node on the server** - the build
happens inside the image, using the Node version the `Dockerfile` pins.

Install Docker Engine and the Compose plugin from Docker's own instructions for your
distribution, then confirm:

```bash
docker --version
docker compose version
```

---

## Step 4: create a user and get the code

Do not run this as root. Give it its own unprivileged user that owns nothing else:

```bash
sudo useradd --system --create-home --home-dir /srv/kalendhair --shell /usr/sbin/nologin kalendhair
sudo mkdir -p /srv/kalendhair
sudo chown kalendhair:kalendhair /srv/kalendhair
```

Clone into it. A deploy key or a personal access token is the usual way to read a private
repository from a server:

```bash
sudo -u kalendhair git clone https://github.com/ggrl/kalendhair.git /srv/kalendhair
cd /srv/kalendhair
```

That user must be in the `docker` group to run compose, or you prefix the compose commands
with `sudo`:

```bash
sudo usermod -aG docker kalendhair
```

---

## Step 5: write the `.env` file

This is the step with the most ways to go quietly wrong. The server refuses to start
without any of the required names and tells you which one is missing, so a mistake here is
loud rather than silent. That is deliberate.

```bash
sudo -u kalendhair cp /srv/kalendhair/.env.example /srv/kalendhair/.env
```

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
something that is not the password you set. Hex output cannot. `SESSION_SECRET` and
`MASTER_PASSWORD` are never put in a URL, so base64 is fine for them, and `openssl rand
-base64 24` produces exactly the 32 characters `server/config.ts` demands as its minimum.

Now edit `/srv/kalendhair/.env` and set every value:

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

**`COOKIE_SECURE=true` is the one people get wrong, and it is the reason this file exists.**
When a proxy terminates TLS and forwards to loopback, the board is served over HTTPS while
the Node process still sees a loopback bind. Its own guess therefore says "no TLS here" and
it does not mark the session cookie `Secure`, so the cookie will travel in clear text on any
plain HTTP request to the same hostname. `server/config.ts` documents exactly this case.
Since you are deploying behind a proxy, set it to `true` explicitly and do not rely on the
guess.

Lock the file down. It now holds every secret on the machine:

```bash
sudo chmod 600 /srv/kalendhair/.env
sudo chown kalendhair:kalendhair /srv/kalendhair/.env
```

`.env` is gitignored and must never be committed. See `rules/secrets.md`. If one of these
values ever reaches version control it is burned and has to be replaced, because history is
permanent.

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
exists only to publish the database port for the test suite on a development machine.

The database lives in a named Docker volume called `db-data`, which survives
`docker compose down` but **not** `docker compose down -v`. Learn the difference now rather
than at 19:00 on a Friday.

---

## Step 7: read the startup log before you go any further

```bash
sudo -u kalendhair docker compose logs -f app
```

**Four things to confirm**, and this output is exactly what a correct first run looks like:

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
it, the cause is the cookie: either `COOKIE_SECURE` is `true` and the page is not actually
being served over HTTPS, or it is `false` and the browser is discarding it. The startup log
says which mode the process chose.

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

Take a dump:

```bash
cd /srv/kalendhair
docker compose exec -T db pg_dump -U salon -d salon --clean --if-exists \
  | gzip > /var/backups/kalendhair-$(date +%F-%H%M).sql.gz
```

Put that in a script, run it from cron nightly, and **copy the result off the machine**. A
backup that only exists on the server it is backing up is not a backup: the disk that dies
takes both. Any object storage or a second host will do.

**Then rehearse the restore, on a scratch database, before you need it:**

```bash
# prove the dump can actually be read back
docker compose exec -T db psql -U salon -d postgres -c 'CREATE DATABASE restore_drill;'
gunzip -c /var/backups/kalendhair-SOMEDATE.sql.gz \
  | docker compose exec -T db psql -U salon -d restore_drill
docker compose exec -T db psql -U salon -d restore_drill -c '\dt'
docker compose exec -T db psql -U salon -d restore_drill -c 'SELECT count(*) FROM appointment;'
docker compose exec -T db psql -U salon -d postgres -c 'DROP DATABASE restore_drill;'
```

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

**`trust proxy` is not set, and the login rate limiter is wrong behind a proxy.** Described
at the top of this file. Right now, behind Caddy, all twenty login attempts per five
minutes are shared by every visitor, so one stranger can lock the whole salon out of its own
board at four requests a minute. The fix is a small code change in `server/app.ts` telling
Express to trust exactly one hop, and it must be exactly one: trusting everything makes
`X-Forwarded-For` whatever the caller claims, which removes the limiter entirely. **Do this
before real use.** It is not urgent on a test box.

**The image is built on the server, not in CI.** Simple, and it means the box needs enough
memory to run a TypeScript build. It also means a deploy can fail at build time with the old
version already stopped. Building in CI and pushing to a registry is the tidier end state.

**No health endpoint, so the app container has no healthcheck.** There is no `/health`, so
an uptime monitor has to watch something else. `GET /api/day` answering 401 is a usable
signal: it proves the process is alive and talking to its session layer. A monitor that
treats 401 as failure will page you constantly.

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
| `set POSTGRES_PASSWORD in .env` before anything starts | Compose substitution, not the app. `.env` is missing or not in the directory you ran compose from |
| `... is required and was not set` in the app log | That name is missing from `.env`. The message names the one it wants |
| App container restarts in a loop | `docker compose logs app`. Usually the database URL or a missing secret. `depends_on` waits for healthy, so it is rarely a race |
| App cannot reach the database | `DATABASE_URL` must use host `db`, not `127.0.0.1`. Compose sets this; check you did not override it in `.env` |
| Login accepted, then bounced back to login | `COOKIE_SECURE` disagrees with whether the page is really on HTTPS. The startup log says which mode it chose |
| Caddy cannot get a certificate | DNS not resolving to this box yet, or port 80 blocked at the cloud firewall rather than at `ufw` |
| Everyone locked out of login at once | The `trust proxy` gap above |
| Update seems to do nothing | `--build` was omitted, so compose reused the old image |
| Board works, then dies after a reboot | Docker is not enabled at boot. `restart: unless-stopped` cannot help if the daemon never starts |
| Password in `.env` does not work | Expected after first run. ADR-0017: the environment seeds once, then the settings screen owns it. Use `MASTER_PASSWORD` to reset |
| `docker compose config` printed all my secrets | It renders `.env` in plain text by design. Never paste that output into an issue or a chat |
