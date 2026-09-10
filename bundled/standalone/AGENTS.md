# AGENTS.md

<!-- ai-rulebook:start -->
<!-- Managed by the AI Rulebook extension. Text between the ai-rulebook markers is regenerated on install; toggle rules from the AI Rulebook sidebar instead of editing here. -->

<!-- ai-rulebook:rule code enabled -->

## Code

- Before adding a helper, search for an existing one. Reuse or extend rather than adding a near-duplicate.
- Place new code with the feature it belongs to; import across features via their public entry point, not deep paths.
- Prefer the standard library or an already-present dependency over adding a new one; flag any new dependency in your report.
- Never add a dependency that is prerelease, unmaintained (archived, deprecated, or no release in roughly two years), or requires an EOL runtime. Flag existing ones; don't migrate them unasked.
- Validate input that crosses a trust boundary (user input, network, files, environment). Never log or commit secrets. Wrap errors with context; never swallow them.

<!-- ai-rulebook:end-rule code -->

<!-- ai-rulebook:rule docs enabled -->

## Docs

If the project has no existing documentation convention, use this layout;
if it already follows a different one, match it instead:

- The repo root is for files platforms and tools read by path: `README.md`,
  `CHANGELOG.md`, `AGENTS.md`, `LICENSE`, `CONTRIBUTING.md`, and
  `SECURITY.md`.
- Feature specs follow GitHub Spec Kit: `specs/<NNN-feature>/spec.md` with
  its `plan.md` and `tasks.md`, and project principles in
  `.specify/memory/constitution.md`.
- Every other doc lives under `docs/` and is linked from `README.md`.
- Place a doc not listed below by the same principle: root only if a
  platform reads it there, otherwise `docs/`.

Before reporting a task done, scan this trigger list once against what you
changed. Update only when the file already exists and the trigger applies:

- `README.md` — usage or configuration changed.
- `CHANGELOG.md` — release-worthy change, under `[Unreleased]` in Keep a
  Changelog form (`Added`/`Changed`/`Fixed`). Entries are user-facing:
  describe the visible change, not the implementation; skip internal
  refactors.
- `AGENTS.md` — build or test commands, conventions, or other
  agent-relevant facts changed.
- `CONTRIBUTING.md` — contribution process, dev setup, or how tests are
  run changed.
- `specs/<NNN-feature>/spec.md` — that feature's testable behavior
  changed; keep its `plan.md` and `tasks.md` consistent. (A project that
  tracks requirements in a single `docs/REQUIREMENTS.md` instead: same
  trigger.)
- `docs/ARCHITECTURE.md` — module boundaries, data flow, or a stated
  invariant changed.
- `docs/RELEASING.md` — the release process changed.
- `docs/DEPLOY.md` — deploy steps, environment variables, or infra config
  changed.
- `docs/decisions/` — you and the user chose between real alternatives and
  the choice constrains future work: append the next `NNNN-short-title.md`;
  never rewrite old ones.

Create a doc only on its trigger, never speculatively:

- Graduation: a `README.md` section has outgrown roughly a screenful
  (~50 lines) — move it to the matching file above and leave a link behind.
- First occurrence: `CHANGELOG.md` at the first release, `AGENTS.md` at
  the first agent-relevant fact worth recording, and
  `docs/decisions/0001-short-title.md` at the first recorded decision —
  confirm with the user before starting a project's first decision record.
- `specs/` only when the project already uses Spec Kit or the user asks to
  adopt it — never to document a feature you built without being asked for
  a spec.

<!-- ai-rulebook:end-rule docs -->

<!-- ai-rulebook:rule git enabled -->

## Git

- Don't commit, push, or create branches unless asked.
- When asked to commit: stage only the files the task touched — never a
  blind `git add -A` — and write an imperative subject line with a body
  that says why.
- Never force-push, rebase, amend, or reset away pushed history unless the
  user explicitly names that operation.

<!-- ai-rulebook:end-rule git -->

<!-- ai-rulebook:rule markdown enabled -->

## Markdown

When editing `.md` files:

- One H1; never skip heading levels.
- `-` for bullets; language tag on every fence.
- Inline code for paths, commands, and filenames.
- Relative links for in-repo targets.

<!-- ai-rulebook:end-rule markdown -->

<!-- ai-rulebook:rule scope enabled -->

## Scope

- Change only what the task requires. No drive-by refactors, renames, reformatting, or version bumps.
- Tests and documentation for the change itself are part of the task, never drive-by work.
- Match the conventions of the file you're editing, even where they conflict with these rules.
- If a rule implies work outside the task, state it and move on — don't act on it.
- An unrelated bug or dead code you notice gets reported, not fixed.

<!-- ai-rulebook:end-rule scope -->

<!-- ai-rulebook:rule tests enabled -->

## Tests

- For behavior changes, write the failing tests for the requirement first, then write the code to make them pass.
- Match the project's existing test file location and naming convention (colocated, mirrored `tests/` folder, feature-grouped, etc.). If none exists, ask when the user is available; working autonomously, default to colocating the test next to the source file it covers using the ecosystem's standard suffix (e.g. `foo.test.ts`, `foo_test.go`).
- Behavior changes require added or updated unit tests, then run the project's test command.
- Run the project's existing lint and type checks before reporting done; fix what you introduced. Never add, configure, or disable a linter the project doesn't already use.
- Never make a test pass by weakening an assertion, skipping or deleting the test, widening a type, or suppressing a lint rule.
- Report every failing test and every relevant check not run. Never describe an unrun test as passing.

<!-- ai-rulebook:end-rule tests -->
<!-- ai-rulebook:end -->
