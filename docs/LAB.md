# Lab: Build "Domain Security Check" From Zero

## What this is

A lab guide anyone can follow: solo at home, in a group, or in a class with one
person driving on a shared screen. You start from an empty folder. Stage 0 mints
your own repository and proves a living deploy pipeline **before any code
exists**; stages 1 to 7 build the app on top of it.

**How this file relates to the deck:** the slides are the frame - the route map,
the watch-list, the traps. This file is the full step-by-step reference route:
every stage, every request word for word, every "done looks like". When a live
session wanders - and it should - this file is where you find the way back.

**The goal, stated once:** a page where you type a domain name and see two
things: whether its email can be spoofed - SPF, DMARC, DKIM - and whether its
website sends the security headers browsers respect. Two checks, one page, no
accounts, no stored data. Both halves are part of the goal from the start: both
are built inside stage 4 - part one directly, part two after a wall.

Stage 0 plus the seven stages below are the shape of the session, not a script
to read aloud. Follow them in order; the words inside each "ask the agent" line
are a starting point, not a transcript - and from stage 4 on, the build is a
conversation: the agent's own noticing steers the order of the small pieces.

**The standing rule, from stage 0 step 4 onward:** every push builds a preview;
a merge to `main` builds production. Every build stage therefore ends the same
way - commit, push, look at the preview - without being told again.

## Stage 0: your own repository and a living pipeline - before any code

Four steps, from an empty folder to a proven pipeline. Everything later rides on
this; doing it cold in the middle of a build eats the session's best minutes.

One prerequisite from earlier: a free Vercel account (the Hobby plan) tied to
your GitHub account. If you do not have one yet, create it at vercel.com first -
two minutes in the browser.

### Step 1: mint your repository ("Use this template")

Open **github.com/CyberstepsDE/VibeEngineering**. Press **Use this template ->
Create a new repository**: owner - your account, name - after the project
(`domain-check` works), create.

One sentence on the button: a **fork** stays tied to our repository and is the
right tool for contributing back to the template; **Use this template** mints a
fresh repository that is only yours - a clean history, no link back, with every
rule, agent, hook and check already tracked.

**Done looks like:** `github.com/<you>/domain-check` exists and shows the
starter's files.

### Step 2: clone it and wake the agent

```bash
git clone https://github.com/<you>/domain-check.git
cd domain-check
npm ci
```

Open the folder in your agent and type `/start` - nothing else yet. Let it read
`AGENTS.md`, run `npm run verify` green on a template with no application in it,
and report back what it found - a tool describing its own starting state instead
of assuming one.

**Done looks like:** the agent has stated, in its own words, what this
repository currently is (a clean workflow template, no app yet) and the checks
are green. The goal has not even been mentioned yet, and no code written.

**If it drags:** `npm ci` on slow wifi is the usual culprit - run it before the
session so `node_modules/` is already warm.

### Step 3: the agent wires its own pipeline

Hosting gets wired before any feature exists - and wiring a tool is agent work
like any other: it runs the commands, reads the answers, and shows the output as
proof. The same move configures any command-line tool or MCP server you meet
later.

**Ask the agent, in these words:** "Connect this project to Vercel from the
terminal: log in, link the project, connect the git remote. Show me each
output."

What it will run, and what each command does:

- `npx vercel login` - signs the CLI into your Vercel account. A browser window
  opens and **you click the confirmation yourself - the one human step in the
  whole pipeline.**
- `npx vercel link` - ties this folder to a new Vercel project (the setup
  questions' defaults are fine).
- `npx vercel git connect` - takes the repository address from the local git
  config and connects it to the linked project, so every push builds from now
  on.

The commands are Vercel's own CLI reference: vercel.com/docs/cli (login, link,
git).

**Done looks like:** `vercel link` has confirmed the project by name and the
project is visible in the Vercel dashboard - a wired pipeline, still with no
app.

**If it drags:** if the agent stalls waiting on the login handshake, finish the
sign-in in the browser yourself and hand back only the `link` step.

### Step 4: prove the pipeline is alive

Before any feature: one trivial change rides the whole road, so the road is
known-good while everything is still simple.

**Ask the agent:** "Change the page title in `index.html` to Domain Security
Check. Make a branch, commit, push, and open a pull request - then hand me the
preview address."

Watch the road, in order:

1. The commit lands on a **branch** - a commit on `main` is refused by the
   template's hook, which you may even see happen.
2. The **push** makes Vercel build a **preview**: a shareable address just for
   this branch. Open it - the new title is live.
3. The **pull request** makes CI run `npm run verify` on GitHub's machines -
   watch the two checks turn green on the pull request page: `verify` (the
   project's own gate) and `browser` (a robot browser clicking the page). (They run on the
   pull request, not on a bare branch push.)
4. **Merge** - the button is yours. Vercel builds `main`, and the **production**
   address shows the change.

Say the rule out loud once: **every push builds a preview; a merge to `main`
builds production.** It holds for the rest of the lab, and for every project
after it.

**Done looks like:** the new title is live at the production address, and you
watched it pass the preview and both green checks on the way there.

**If it drags:** the preview address is on the pull request page and in the
Vercel dashboard; the green checks live on the pull request.

## Stage 1: say the goal - both halves in one sentence

The pipeline is live and empty. Now the goal - and it names both parts of the
app from the first sentence.

**Ask the agent** - give it the goal in one sentence: a page where you type a
domain name and see two things: whether its email can be spoofed (SPF, DMARC,
DKIM) and whether its website sends the security headers browsers respect. No
accounts, nothing stored.

This sentence is the scope: both halves are built inside stage 4 - part one
first, part two after the wall. When "security headers" returns later, it is
this sentence being executed - not new work appearing.

**Done looks like:** the agent has repeated the goal back with both halves
intact and has not written any code.

**If it drags:** if the agent starts proposing implementations already, hold it
- the interview comes first.

## Stage 2: the agent interviews you (`/grill-me`)

Before it writes a line of code, it asks questions - answer as the person who
wants this tool, not as a programmer.

**Ask the agent:** to run `/grill-me` and interrogate the goal: who is this for,
what counts as "protected", what happens on a domain with no records at all,
what this deliberately does not do (no port scanning, no storing of domains
anyone has looked up, no scanning of anything other than the one domain typed
in).

**Done looks like:** the agent produces the eight-line brief (`Actor`,
`Observation`, `Outcome`, `Mechanism`, `Examples`, `Non-goals`, `Permissions`,
`Done when`) and it matches what you actually want - correct it out loud if not.

**If it drags:** answer briefly and move on rather than debating every question -
the brief can be corrected later, and a fast, roughly-right answer teaches the
pattern better than a stalled interview.

## Stage 3: the agent writes the plan - with both parts on it

It does not start typing code yet either - the plan comes first, so you can
object before it builds the wrong thing.

**Ask the agent:** to turn the brief into a short, concrete plan: one page, one
domain field; part one the email checks (SPF, DMARC, DKIM); part two the
website's security headers; every check reporting pass, fail, or an honest "not
detected"; all work on a branch with a commit and a push after every stage, so
the preview always shows the latest state; `README.md` updated to describe the
real application once it exists.

**Done looks like:** a short, readable plan exists (in the chat or a file) that
names both parts and the push-after-every-stage rule, and you have said "yes,
build part one" before any source file changes. Stage 4 executes this plan in
order - part one, then part two; nothing new appears mid-build.

**If it drags:** accept a plan stated out loud instead of written to a file, and
move on - the point is that a plan existed and was agreed to, not its format.

## Stage 4: the build - a conversation

From here there is no script. The agent builds; what it notices, what it grills
you about, what it wants to improve first - no two live builds run the same, and
this guide stops pretending otherwise. Two things replace the script:

**The rhythm.** One small piece at a time: you ask in plain words, the agent
builds, commit and push, the preview rebuilds, you look. Around again until both
halves of the goal are live.

**The watch-list.** Seven catches worth holding in view the whole time:

1. **The DKIM verdict** - no fixed selector exists, so a missed guess proves
   nothing: demand "not detected", never "fail".
2. **Strange inputs** - a typo, an empty field, a domain that does not exist, a
   whole URL pasted in: fly each by hand on the preview after every piece.
3. **The wall** - at the headers half the browser will refuse to hand your
   script a stranger's response. By design, not a bug: the fix is a small
   serverless function in `api/` - the agent proposes it, or you request it.
4. **A fix without a test** - the template ships no DOM test harness on
   purpose: have every fix pinned, and watch the agent install the missing
   harness itself - a task, not an oversight.
5. **What failure looks like** - agents polish the happy path and skip the sad
   one: break it on purpose and read what a stranger would see.
6. **A long silence, no push** - work you cannot see: commit and push after
   every piece; the preview is your window.
7. **A word you do not know** - jargon, and decisions made in passing: a
   one-sentence explanation before moving on.

The parts below are the reference route through that conversation - the detail
the slides deliberately do not carry.

### Part one: the email checks (SPF, DMARC, DKIM)

Build the part that needs no server at all - a browser can ask the internet's
phone book directly.

**Ask the agent:** to build the domain form and query DNS straight from the
browser using DNS-over-HTTPS (DoH) - a way of asking a DNS question over a
normal HTTPS request instead of the raw DNS protocol, which is why a browser can
do it without any backend. Cloudflare's DoH JSON endpoint
(`https://cloudflare-dns.com/dns-query`, with an `accept: application/dns-json`
header) deliberately allows requests from any website's JavaScript - its
response carries `Access-Control-Allow-Origin: *`. Concretely:

- **SPF** - a TXT record on the domain itself, starting with `v=spf1`.
- **DMARC** - a TXT record on `_dmarc.<domain>`, starting with `v=DMARC1`.
- **DKIM** - a TXT record on `<selector>._domainkey.<domain>`. There is no fixed
  selector; a real check can only try a short list of common ones (for example
  `google`, `default`, `selector1`) and report "not detected", never "fail",
  when none of them match - a wrong selector proves nothing about whether DKIM
  exists.

**Done looks like:** typing a real domain shows a genuine pass or fail for SPF
and DMARC, and an honest "not detected" (not a false "fail") for DKIM. The stage
ends the standing way: commit, push, and the preview shows the working form at a
shareable address.

**If it drags:** have the agent get ONE query working end to end first - SPF on
a single hardcoded domain, printed raw to the page - before generalizing to a
form and all three records.

### The landing: you take the controls

The arc from the deck's opening, kept on purpose: setup was takeoff, the agent
flew the build - **the landing is a human's**. Close the terminal: open the
preview like a person who just got the link, and work the checklist by hand.
Run it in full after part one, and rerun it after every later piece - landings
repeat.

The tester's checklist - five inputs, and what an honest page does with each:

| You type | What should happen |
| --- | --- |
| a real domain with no DMARC | a plain fail or "absent" for DMARC - the other checks still reported |
| a typo of the domain you meant | an answer for the domain you actually typed - the page cannot know what you meant; notice you scanned the wrong name |
| an empty field | a polite refusal with a message - no request fired, nothing crashes |
| a domain that does not exist | "domain not found" in plain words - not a stuck spinner, not console noise |
| a full URL pasted in | cleaned to its domain, or refused with "enter a domain, not an address" - never silently queried as typed |

If every row already behaves, feed stranger inputs until one gives - finding
nothing after honestly trying is a result too.

**For every breakage, in this order:** read the exact message (in the page or
the browser console), name the cause in one sentence BEFORE any code is touched,
then have the agent fix it - and prove the fix by re-running the same input that
broke it, not by re-reading the code.

**Then pin the fix with a test - and watch the agent configure itself.** Ask the
agent to write a component test that types the exact input that just broke the
app and asserts the fixed behaviour. The template deliberately ships no DOM test
environment - the unit harness runs plain Node - so the agent has to notice the
missing piece and add it itself: install the packages (jsdom and a component
testing library), wire the test environment into the config, and prove it by
running the new test red-green. The point to notice: **the setup is not missing
by accident, it is a task - an agent can extend its own harness, and you just
watched it happen.**

**Done looks like:** every row of the checklist was tried on the preview; each
cause was named from a real message before its fix; the failing inputs now pass
and live in a component test the agent could only run after configuring the DOM
environment on its own. Commit, push - the preview carries the fixes.

**If it drags:** if no error surfaces within a couple of minutes, feed it a
domain known to have no DNS records at all, or a malformed one - that reliably
finds the gap between "the happy path works" and "the code handles reality". If
time is short, the self-configuration beat can shrink to the install-and-config
step with the test left for later.

### Part two: the wall, then the smallest backend

Part two of the plan, asked the obvious way - and it is worth hitting the wall
for real.

**Ask the agent, in these words:** "Add the security-headers check the same way
as the DNS check - fetch the target site straight from the browser. Try
example.com."

What you will see:

- the report stays empty, and the browser console shows a message of this shape
  (Chrome's wording; other browsers phrase the same refusal differently):

  ```text
  Access to fetch at 'https://example.com/' from origin
  'https://<your-preview>.vercel.app' has been blocked by CORS policy:
  No 'Access-Control-Allow-Origin' header is present on the requested
  resource.
  ```

- the network tab lists the request - the answer reached the browser - but the
  status column says "CORS error" and the page's script never gets to read it.

Why: the blocker is the **browser** - not example.com, and not the code just
written. A page's script may not read another site's response unless that site
opts in; reading a stranger's responses is cross-site snooping, exactly what the
browser's security model exists to stop. DNS worked with the same trick only
because Cloudflare's endpoint opts in on purpose. Have the agent explain this
wall in its own words before fixing anything - **this is the point of the whole
lab.**

Then: ask it to build the smallest thing that solves it - one small serverless
function (in an `api/` folder, deployed by Vercel) that fetches the target site
from a server, where no browser cross-origin rule applies, and hands back just
the headers that matter as plain JSON. The page then calls this function -
`/api/headers?domain=...` - instead of calling the target site directly.

**Done looks like:** you can state, unprompted, why DNS worked from the browser
and headers did not. The network tab shows the page calling your own `/api/...`
endpoint. The stage ends the standing way: commit, push - the preview returns
real header results (serverless functions run on the preview too).

**If it drags:** get the function working from the command line first (call it
directly, read the raw JSON back) before wiring the page to it - that separates
"does the function work" from "does the page call it correctly".

### Make it yours: prompts to keep going

Both halves work. From here, extension is one prompt away - each of these is a
complete brief in plain words, and each rides the same road: branch -> push ->
preview -> review -> merge.

A nicer face:

- "Make the report easy to read at a glance: green, amber or red per check, a
  one-line explanation for each, mobile first."
- "Add a small header with the app name and one line saying what this checks."
- "Let each check expand to show the raw record behind the verdict."

More powers:

- "Add a button that copies the whole report as plain text."
- "Let me check several domains at once - one per line."
- "Remember the last five domains I checked - in the browser only, no server
  storage."

## Stage 5: review before the merge - two passes attack the branch

The branch is pushed and its preview works. Nothing MERGES until minds that did
not write the change say SHIP - both of them.

**Ask the agent:** nothing - this stage belongs to fresh minds. Open a fresh
agent session, point it at the branch, and run the two review passes from
`AGENTS.md` section 3: first the logic reviewer (`.claude/agents/reviewer.md` -
read-only tools, no editing), then the security pass
(`.claude/agents/security-reviewer.md`, or Codex if you have it - a different
model has different blind spots). The logic reviewer reads
`git diff main...HEAD`, then every changed file in full, and runs
`npm run verify` itself - believing its own run, not the builder's report. Each
pass returns SHIP or NO-SHIP, findings worst first, each carrying the concrete
sequence that triggers it.

**Done looks like:** both passes have said SHIP, on their own run of the checks,
from minds that did not write the change. NO-SHIP findings go back to the first
agent to fix; the reviewer reads the result again. The merge waits on them -
pushes and previews never did.

**If it drags:** if a reviewer answers SHIP immediately, read its "what I tried"
list - a review that names its attack paths teaches more than a bare pass. If
time is short, fix only the findings that carry an executable sequence and keep
the rest as notes.

## Stage 6: merge - two SHIPs, two green robot checks, and production builds itself

Two different gates guard `main` - minds, and a robot - and the pull request
page is where both show.

**Ask the agent:** nothing - this stage is yours. Open the pull request page and
take stock:

- The **review passes** (stage 5) were minds reading the change - and they ran
  on your machine. They are deliberately NOT in CI: there they would need model
  API keys, so this repository keeps review local, and the push-time hook only
  reminds you it exists.
- The **CI check** is a robot: the same `npm run verify`, run by GitHub on every
  pull request - it re-ran on every push. It cannot judge intent, and it cannot
  be forgotten either.

With two SHIPs and green checks: **merge** - the button is a human's. Vercel
builds `main`; production carries the app.

**Done looks like:** real results for real domains on a phone, at the production
address - both checks, live. The app working in your hand is the proof, not a
"deployed successfully" line.

**If it drags:** a red check on the pull request names the command that failed -
run the same command locally, fix, push; the check re-runs on the new commit.

## Stage 7: secure it

You just built a tool that judges other sites' security headers. What does it
say about your own?

**Ask the agent:** to run the app's own header check against its own production
address, add whichever headers are missing (they ride the same road: branch,
push, review, merge), and then explain - in words, not necessarily in code, if
time is short - what stops a stranger from using the public `/api/...` endpoint
as a free way to probe arbitrary domains at volume. Two guards fit in one
sentence each: a minimal rate limit on the endpoint, and an allowlist of caller
IP addresses checked inside the function itself (read the `x-forwarded-for`
header - the hosting platform sets it, so it cannot be faked; to learn your own
address, ask the function to echo what it sees).

**Done looks like:** the app's own deployed headers pass its own check, and you
can explain both guards - the rate limit and the in-function IP allowlist - even
if the code for them was not written today.

**If it drags:** do the self-check and the header fixes live, and leave the
guards as a spoken explanation and a follow-up task rather than code - a clear
explanation of an unfixed gap is worth more than a rushed fix nobody understood.
