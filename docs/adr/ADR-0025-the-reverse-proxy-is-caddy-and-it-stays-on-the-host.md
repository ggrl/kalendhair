# ADR-0025: The reverse proxy is Caddy, and it stays on the host

- Status: accepted, 2026-08-16. Written, not yet run on a real server.
- Completes [ADR-0005](ADR-0005-self-hosted-containers.md), which said the stack "sits behind a
  reverse proxy terminating TLS" and left both which one and where it runs unanswered.

## Context

ADR-0005 named two services, a Node server and Postgres, and said they sit behind a proxy
terminating TLS for a real domain. Building `DEPLOYMENT.md` and the compose app service
forced two questions it had left open, and both were asked of the owner rather than assumed.

They matter because [ADR-0004](ADR-0004-one-shared-salon-password.md) puts one shared
password in front of everything: over plain HTTP that password, the session cookie and every
customer name are readable in transit. The proxy is the only thing standing between the
salon and that, so where it lives and what runs it is not a detail.

## Decision

**The proxy runs on the host, not as a third compose service.** `docker-compose.yml` keeps
the two services ADR-0005 named. The app publishes to `127.0.0.1:3000` and the proxy reaches
it there.

**It is Caddy**, with nginx and certbot named in `DEPLOYMENT.md` as the supported
alternative for somebody who already runs nginx.

## Why Caddy rather than certbot and nginx

Four reasons, in the order they matter here.

**The configuration is two lines, because this application is one upstream.** The server
serves the built board with `express.static('dist')` and answers the API on the same port, so
the proxy has exactly one job. There is no static root to configure separately, no second
upstream, no PHP. Most of what nginx is good at is unused, and what remains is boilerplate
that has to be correct.

**Renewal is the part that fails silently, and Caddy fails where you are already looking.**
Certbot installs a separate systemd timer. If it breaks you find out ninety days later, and
because `COOKIE_SECURE` is set, an expired certificate is not a degraded board - the session
cookie stops coming back and nobody can log in at all. Caddy renews inside the process whose
log you are already reading.

**The HTTP to HTTPS redirect is automatic.** With nginx it is written by hand, and a missing
one produces the exact confusing symptom `DEPLOYMENT.md` has a troubleshooting row for:
login accepted, then straight back to the login screen.

**Caddy's `reverse_proxy` sets the forwarding headers by default.** In nginx they are manual
`proxy_set_header` lines and forgetting them is a classic. That matters more here than
usual: the moment `trust proxy` is fixed, three rate limiters depend on `X-Forwarded-For`
being correct.

## Why the proxy is not a compose service

Adding it would make deployment one command including TLS, which is genuinely attractive.
Rejected, on the owner's decision:

- ADR-0005 names two services and describes the stack as sitting *behind* a proxy. Putting it
  inside would be re-deciding that ADR rather than completing it.
- The certificate storage becomes a Docker volume. Losing a volume is easier than losing a
  directory, and re-issuing runs into the Let's Encrypt rate limit - which, on the
  `cloudapp.azure.com` name the Azure test box uses, is shared with strangers.
- Ports 80 and 443 would then be published by Docker, whose DNAT rules bypass `ufw`. Today
  the only published port is bound to loopback, which is what makes the firewall question
  simple.

## What was rejected on the way

**nginx with certbot.** Not because certbot is hard - `certbot --nginx` writes the config for
you. It loses on the four points above, and wins on one that cannot be weighed from here:
if the person maintaining this already has an nginx habit, familiarity beats elegance at
19:00 when the board is down. `DEPLOYMENT.md` therefore documents it as a real alternative
rather than a footnote.

## Consequences

**This is a reversible choice and should stay one.** Nothing in the application knows which
proxy is in front of it. Swapping is an afternoon, which is why the reasoning above is
recorded as a preference with its counter-argument rather than as a rule.

**One package on the host is outside the compose file**, so "the whole stack is
`docker compose up -d`" is true of the application and not of TLS. `DEPLOYMENT.md` says so.

**Untested against a live proxy.** Everything in this ADR and in `DEPLOYMENT.md`'s proxy
section is read from documentation and from this code, not observed with Caddy actually
running in front of the board. Three review passes flagged the same thing: the `trust proxy`
behaviour in particular has never been fired at a real proxy. The first deployment is the
test, and what it finds belongs back in `DEPLOYMENT.md`.
