#!/usr/bin/env bash
# PreToolUse[Bash] guard: never commit on the main branch.
#
# AGENTS.md section 3 is explicit - work happens on a short-lived branch, never
# straight on main. This hook is the code that makes that a rule instead of a
# request, for one tool: Claude Code. Codex, Cursor and a human typing in a
# terminal never run it - for them the rule binds by being read. Honesty about
# what a guard actually covers is part of the guard.
#
# WHY IT CHECKS FOUR COMMAND FORMS: a guard must enumerate EVERY syntactic form
# of the operation it restricts. The one-form version of this script (only a
# leading `cd <dir>`) was measured letting `git -C <dir> commit` and
# `git --git-dir=... commit` walk straight past it. If you trim this file,
# re-test all four forms.
#
# EXIT CODES MATTER: in Claude Code hooks, ONLY exit 2 blocks the action.
# Exit 1 is a non-blocking error and the action proceeds. Fails OPEN by design:
# an unparseable payload must never become an unexplained refusal.

set -uo pipefail

input=$(cat)

# Not a commit -> nothing to say. Matches `git commit`, `git -C x commit`,
# `git --git-dir=... commit`; the word-boundary check keeps `git commit-graph`
# out of it.
printf '%s' "$input" | grep -qE '\bgit\b[^"'"'"';|&]*\bcommit\b' || exit 0

command_line=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | awk 'NR==1')
[ -n "$command_line" ] || command_line=$input

resolve_dir() {
  local line="$1" dir=""

  # Form 1: git -C <dir> ... commit   (also -C=<dir>)
  dir=$(printf '%s' "$line" | sed -n 's/.*[[:space:]]-C[[:space:]=]*\([^ "'"'"';|&]*\).*/\1/p' | awk 'NR==1')
  if [ -n "$dir" ] && [ -d "$dir" ]; then printf '%s' "$dir"; return; fi

  # Form 2: git --git-dir=<dir>/.git  -> the repository is its parent
  dir=$(printf '%s' "$line" | sed -n 's/.*--git-dir[[:space:]=]*\([^ "'"'"';|&]*\).*/\1/p' | awk 'NR==1')
  if [ -n "$dir" ]; then
    dir=${dir%/.git}
    if [ -d "$dir" ]; then printf '%s' "$dir"; return; fi
  fi

  # Form 3: --work-tree=<dir>
  dir=$(printf '%s' "$line" | sed -n 's/.*--work-tree[[:space:]=]*\([^ "'"'"';|&]*\).*/\1/p' | awk 'NR==1')
  if [ -n "$dir" ] && [ -d "$dir" ]; then printf '%s' "$dir"; return; fi

  # Form 4: a leading `cd <dir>`
  dir=$(printf '%s' "$line" | sed -n 's/.*[[:space:]]*cd[[:space:]]\{1,\}\([^ "'"'"';|&]*\).*/\1/p' | awk 'NR==1')
  if [ -n "$dir" ] && [ -d "$dir" ]; then printf '%s' "$dir"; return; fi

  # Form 5: none of the above - the shell's own working directory.
  printf '%s' "$(pwd)"
}

dir=$(resolve_dir "$command_line")
branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0

if [ "$branch" = "main" ]; then
  echo "BLOCKED (AGENTS.md section 3): HEAD in $dir is on 'main' - work belongs on a branch. Run: git switch -c <branch-name>, then commit." 1>&2
  exit 2
fi

exit 0
