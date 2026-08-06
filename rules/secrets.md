# Secrets

> **Audience:** any AI coding agent working in this repository.
> **Load this when:** you touch configuration, deployment, an external service, or
> anything that authenticates.

## The rule

**No key, token, password, or connection string goes into a file that gets
committed.** Not in code, not in config, not in a comment, not in a test fixture, not
in an example, not in a commit message.

## Why it is absolute

Version control is permanent. Deleting a secret in a later commit does not remove it
- it stays in the history, and the history gets cloned, forked, mirrored and backed
up. **A secret that has touched version control is burned and must be replaced**, no
matter how quickly it was removed. There is no such thing as a small exposure.

This repository has no secrets, on purpose. It is browser-only and talks to nothing.
That is a design decision, not an accident, and it is why it can be public.

## Where secrets live instead

- Locally: an environment file that is listed in `.gitignore` before it is created.
- In a hosting platform: its own environment-variable store, set through its console
  or command line, never in a file in the repository.
- In an automation pipeline: its secret store, exposed to a job as an environment
  variable at run time.

Marking something as a secret in a configuration file does NOT protect it if the real
value is written in that file. The file is what gets committed.

## Before every commit

```bash
git diff --cached
```

Read it. Actually read it. Look for anything that resembles a key, a token, a password
or a URL containing credentials, and confirm your ignore file covers every location
where secrets live.

**Stage explicit paths.** `git add -A` and `git add .` sweep up whatever is lying
around: an environment file you created five minutes ago, an export you made while
debugging, a screenshot with a session in the corner. Name what you are committing.

## When you are handed a secret

If somebody gives you a secret value in conversation:

1. Acknowledge it **without repeating the value back**. It is now in the transcript
   once; do not make it twice.
2. Put it straight into its proper home.
3. Never write it to a file, even a temporary one.
4. Say it should be rotated, because it has been in a chat log.

## Diagnostics leak too

The most common real exposure is not a committed key. It is a broad diagnostic
command whose output nobody read before pasting it.

This has happened: a read-only command, run for a legitimate reason, returned
configuration that included credentials, and the whole output went into a report.
Reading is not the same as safe.

**Ask for the narrowest output that answers your question.** Request the specific
fields, not the whole object. Before pasting any command output into a report, look
at it. If a secret has appeared anywhere - a log, a report, a transcript, a
screenshot - say so immediately and clearly. It has to be replaced, and the only
thing that makes that expensive is finding out late.

## Related

`facts-only.md` - the habit of reading output rather than assuming what it contains
is the same habit that catches this.
