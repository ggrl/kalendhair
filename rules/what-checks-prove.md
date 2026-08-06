# What each check proves, and what it cannot

> **Audience:** any AI coding agent working in this repository.
> **Load this when:** you are about to say a piece of work is done, verified, safe,
> or ready. Also load it when you are deciding what evidence to ask for.

## The rule

**Never report a piece of work as done on the strength of a check that could not
have detected the failure you are worried about.**

Every check answers one narrow question. Knowing which question is the whole skill.
The table below is the entire rule; the rest is why.

| Check | What it proves | What it does NOT prove |
| --- | --- | --- |
| Type checking | The code is internally consistent with itself | That it does the right thing |
| A unit test | The rule somebody asserted holds | Anything nobody thought to assert |
| A browser test | One path works, in one starting state | That a real person's state works |
| The whole suite green | Nothing you already knew about broke | That the new thing works |
| A code review | Somebody looked | That they looked at the right part |
| A successful build | It compiles and bundles | That it runs |
| A successful deploy | Some version is running | Which version, unless you check its identity |
| A health endpoint | The server answers | That any feature works |
| A redirect for a logged-out visitor | The route exists and is protected | Anything about the page a logged-in person sees |
| No linter warnings | It matches the style rules | That the logic is right |
| A security scanner finding nothing | It found none of the patterns it knows | That there is nothing to find |

## The two failures this exists to prevent

**A green suite that inherited the wrong assumption.** A first-login walkthrough was
covered by tests, and every one of them passed. Every test began by putting something
in the queue first, because that was how the author pictured it. A genuinely new
person has an empty queue - so the one state that every real first-time user is in was
the one state nothing exercised. The suite was not weak. It was answering a question
nobody had asked.

**A deploy reported as live that was not.** A watcher reported the deployment as
active. It had read a row from nine days earlier. "Active" is a status, not an
identity: without the version, the timestamp and the commit, it tells you that
something is running, not that your something is running.

## What to do instead

1. **Name the failure you are worried about, in one sentence.** "A student sees
   content from the wrong session on their page."
2. **Ask which check would have caught that.** If the honest answer is "none of them",
   you do not have evidence. You have a green pipeline, which is a different thing.
3. **Get the evidence at the level where the risk lives.** A rule about data belongs
   in a test over real data shapes. A rule about what somebody sees belongs in
   something that actually looks at the screen. A rule about a dependency's behaviour
   belongs in a probe against that dependency's real version, not a stand-in you wrote
   yourself, which will politely agree with whatever you believed when you wrote it.
4. **Say what you did not check.** Every report names the gap. "The rule is covered
   by a test, but nobody has opened this in a browser" is a complete and useful
   sentence, and it is worth more than a confident summary.

## The sentence to distrust most

**"All tests pass."**

It is almost always true and almost never the answer to the question being asked. The
question is "does this work for the person who will use it", and a test suite has no
opinion about that at all.
