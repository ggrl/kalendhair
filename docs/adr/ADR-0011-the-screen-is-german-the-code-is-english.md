# ADR-0011: The screen is German, the code is English

- Status: accepted
- Date: 2026-08-12

## Context

The salon works in German. `KW` was asked for by name, which is Kalenderwoche, and the
paper day-sheet this replaces is a German document.

An agent writing this code will reach for English strings by default, because the
instructions, the rules and the decision log are all in English. That default is wrong on
the one surface a receptionist looks at all day, and it is the kind of thing that gets
re-decided quietly one component at a time until the board is half translated.

## Decision

**Everything the salon reads is German.** Weekdays and dates formatted the German way
(`Donnerstag, 13. August 2026`), `Heute`, `Gesperrt`, `Notiz`, `Termine werden geladen …`,
and every error message that reaches the screen.

**Everything a maintainer reads is English.** Code, identifiers, comments, commit messages,
pull request text, `AGENTS.md`, `rules/`, this decision log, and the product brief.

There is no translation mechanism, no locale switch and no string table, because there is no
second audience. The strings live inline in the components that show them.

## Consequences

- An error thrown for the screen has to be written in German at the point it is thrown. That
  is why `src/ui/api.ts` says `Server antwortete mit Status 500` rather than passing an
  English message through a German sentence, which is what it did first.
- A string table would be the obvious place to put these, and it is not worth having for one
  language. If a second language ever arrives, that is when to build one - and this ADR is
  what to supersede.
- Nobody on this project is a native speaker so far. The wording is a first draft and the
  owner corrects it; `Gesperrt` in particular was questioned by a UX review, which suggested
  `Nicht verfügbar`, and was kept because the owner had already approved that word.
- Formatting comes from `Intl` with an explicit `de-DE` locale and a `UTC` timezone, never
  from the machine's locale. A board that renders differently depending on whose laptop it is
  on would be a different bug wearing this decision's clothes.

## Alternatives rejected

- **English throughout.** Simpler for whoever maintains it, and wrong for the people using
  it. They rejected other products for not fitting how they work.
- **Both, behind a switch.** A locale mechanism, a string table and two sets of wording to
  keep in step, for an audience of one salon.
- **German comments and identifiers too.** Consistent, and it narrows who can maintain the
  code for no benefit to the salon, who never see it.
