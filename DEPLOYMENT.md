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

**1. There is no Dockerfile, and no application service in `docker-compose.yml`.** That
file runs Postgres and nothing else, and says so in its own opening comment: the
application service "joins when that gate is met". So `docker compose up` does **not**
start the board. In this guide the database runs in a container and the application runs
directly on the host under Node. That works today and is the honest shape of it.

**2. `trust proxy` is not set, and that matters the moment a proxy exists.** `server/app.ts`
rate limits login to twenty attempts per address per five minutes. Behind a reverse proxy
that Express has not been told to trust, every request appears to come from the proxy, so
the limit stops being per-visitor and becomes one budget shared by everybody. The code
comment states the consequence plainly: a stranger can then hold the salon's door shut at
four requests a minute. **This is a code change that has to happen before real use.** See
[Known gaps](#known-gaps) at the end. It does not block a throwaway test box.

**3. The server uses two relative paths.** `express.static('dist')` and the migration
runner's `'migrations'` are both relative to the working directory. **The process must be
started with its working directory set to the project root**, or it serves no board and
finds no migrations. The systemd unit below does this, and it is the single most likely
thing to get wrong.

Two things the server does for you on every start, so no manual step exists for either:
it **runs any unapplied migrations** (under a Postgres advisory lock, so two instances
starting together is safe), and it **seeds the salon password and PIN from the environment
the first time only**, ignoring them ever after.

---

## Step 0: what you need

- A server running a current Linux. Anything Debian or Ubuntu based matches the commands
  below; adjust the package manager otherwise.
- **A domain name you control.** Not optional. Certificate authorities do not issue
  publicly trusted certificates for bare IP addresses, so without a hostname there is no
  HTTPS, and without HTTPS the shared password and every customer name cross the network
  readable. This is the whole point of `docs/PRODUCT_BRIEF.md`'s stage two.
- Ports 80 and 443 reachable from the internet. Port 80 is needed even though the board is
  HTTPS only, because that is how the certificate challenge arrives.

Size: this is one salon. The smallest instance any provider sells is enough. Postgres and
Node together sit comfortably in 1GB of RAM.

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

**Never open 5432.** The compose file binds Postgres to `127.0.0.1` so it is not reachable
from the network at all, which is ADR-0006's rule. Nothing outside the box needs it.

---

## Step 3: install Node and Docker

The application needs Node **22.12.0 or newer**, which `package.json` enforces through
`engines` and `.nvmrc` pins exactly. Distribution packages are usually older than that, so
install from a source that offers the current release rather than whatever `apt` has by
default. Check the version you end up with:

```bash
node --version    # must be >= v22.12.0
```

Docker is needed only for Postgres. Install Docker Engine and the Compose plugin from
Docker's own instructions for your distribution, then confirm:

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
| `POSTGRES_PASSWORD` | the hex string | |
| `DATABASE_URL` | `postgres://salon:THE_HEX_STRING@127.0.0.1:5432/salon` | the same password, inline |
| `TEST_DATABASE_URL` | same, ending `/salon_test` | unused in production, leave it consistent |
| `SALON_TIMEZONE` | `Europe/Berlin` | ADR-0007. Never left to the server's clock |
| `HOST` | `127.0.0.1` | keep loopback, the proxy reaches it locally |
| `PORT` | `3000` | |
| `SESSION_SECRET` | a base64 string | minimum 32 characters, enforced |
| `MASTER_PASSWORD` | a base64 string | the way back in if password and PIN are both lost |
| `SALON_PASSWORD` | one the salon will type | at least 8 characters |
| `SALON_PIN` | four digits | guards the settings screen |
| `COOKIE_SECURE` | **`true`** | see the warning below |

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

## Step 6: start Postgres

```bash
cd /srv/kalendhair
sudo -u kalendhair docker compose up -d db
sudo -u kalendhair docker compose ps
```

Wait for the health check to report healthy. The data lives in a named Docker volume
called `db-data`, which survives `docker compose down` but **not** `docker compose down -v`.
Learn the difference now rather than at 19:00 on a Friday.

---

## Step 7: build and first run

```bash
cd /srv/kalendhair
sudo -u kalendhair npm ci
sudo -u kalendhair npm run build
```

Then start it once by hand, so you see the startup log before systemd hides it:

```bash
sudo -u kalendhair npm start
```

**Read the output.** It tells you four things you need to confirm:

- `migrate: ...` lines, showing the migrations applying to a fresh database.
- `salon password and PIN seeded from the environment` on a first run. On later runs it
  says they are ignored instead, which is ADR-0017 working correctly, not a fault.
- `salon calendar api on http://127.0.0.1:3000`.
- The cookie decision, stated out loud. With `COOKIE_SECURE=true` you should see
  `session cookie: Secure` followed by a warning that logins will not work at all unless
  something in front terminates TLS. That warning is correct and expected: the proxy does
  not exist yet. It is the next step.

Confirm the API answers, from the server itself:

```bash
curl -i http://127.0.0.1:3000/api/day?date=2026-08-15
```

A `401` with `{"error":"Bitte anmelden."}` is the **right** answer. ADR-0004 gives an
unauthenticated request no day at all rather than a filtered one.

Stop it with Ctrl-C. systemd takes over next.

---

## Step 8: run it as a service that survives a reboot

Create `/etc/systemd/system/kalendhair.service`:

```ini
[Unit]
Description=kalendhair salon board
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=kalendhair
WorkingDirectory=/srv/kalendhair
ExecStart=/usr/bin/node --env-file-if-exists=.env dist-server/server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Two lines in that file are load-bearing and worth understanding rather than copying:

- **`WorkingDirectory=/srv/kalendhair`.** The server serves the built board with
  `express.static('dist')` and reads migrations from `'migrations'`, both relative paths.
  Start it from anywhere else and you get a running API that serves no board and applies no
  migrations. This is the failure mode that wastes an afternoon.
- **`ExecStart` uses `--env-file-if-exists=.env`** rather than systemd's `EnvironmentFile`.
  This is exactly what `npm start` does, so the file is parsed by Node the same way it is
  in development. systemd's own env file parsing handles quoting differently and a password
  containing the wrong character can arrive mangled.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kalendhair
sudo systemctl status kalendhair
sudo journalctl -u kalendhair -f
```

---

## Step 9: the reverse proxy and the TLS certificate

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

## Step 10: before you call it done

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

## Step 11: backups, and the restore that has to actually happen

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
sudo -u kalendhair npm ci
sudo -u kalendhair npm run build
sudo systemctl restart kalendhair
sudo journalctl -u kalendhair -n 50
```

Migrations apply themselves on start, so there is no separate step. Take a backup before
an update that includes a new migration, because migrations are not reversible here and
there is no down path.

There is a short outage during the restart. For one salon that is acceptable; if it ever
is not, that is a load balancer and a second instance, which is a bigger change than this
document covers.

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

**No Dockerfile.** The application runs on the host, so the machine carries a Node
installation and a build step that a fully containerised deploy would not need. Writing a
Dockerfile and adding the app service to `docker-compose.yml` is the tidier end state, and
the compose file's own comment says it is waiting for exactly that.

**No health endpoint.** There is no `/health`, so an uptime monitor has to watch something
else. `GET /api/day` answering 401 is a usable signal: it proves the process is alive and
talking to its session layer. A monitor that treats 401 as failure will page you constantly.

**No log rotation for the application beyond journald's defaults**, and no metrics.

**One shared password, by design.** ADR-0004, with its costs written down. ADR-0004 also
marks itself to be revisited before an iOS app puts that password on phones that leave the
building.

**Secrets live in one `.env` file on the box.** Fine for one salon and one server. If this
ever becomes more than that, it becomes a secret manager.

---

## If something is wrong

| Symptom | First thing to check |
| --- | --- |
| Board is blank, API answers | Working directory. `express.static('dist')` is relative, and `npm run build` must have run |
| `... is required and was not set` at startup | That name is missing from `.env`. The message names it |
| Login accepted, then bounced back to login | `COOKIE_SECURE` disagrees with whether the page is really on HTTPS. The startup log says which mode it chose |
| Caddy cannot get a certificate | DNS not resolving to this box yet, or port 80 blocked at the cloud firewall rather than at `ufw` |
| Everyone locked out of login at once | The `trust proxy` gap above |
| Board works, then dies after a reboot | `systemctl enable` was never run, or the unit starts before Docker |
| Password in `.env` does not work | Expected after first run. ADR-0017: the environment seeds once, then the settings screen owns it. Use `MASTER_PASSWORD` to reset |
