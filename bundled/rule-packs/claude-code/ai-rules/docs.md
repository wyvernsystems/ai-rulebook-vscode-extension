
# Docs

If the project has no existing documentation convention, use this layout;
if it already follows a different one, match it instead:

- The repo root is for files platforms and tools read by path: `README.md`,
  `CHANGELOG.md`, `AGENTS.md`, `LICENSE`, and GitHub community files such as
  `CONTRIBUTING.md` and `SECURITY.md`.
- Every other doc lives under `docs/` and is linked from `README.md`.
- Place a doc not listed below by the same principle: root only if a
  platform reads it there, otherwise `docs/`.

Update only when the file already exists and the trigger applies:

- `README.md` — usage or configuration changed.
- `CHANGELOG.md` — release-worthy change, under `[Unreleased]` in Keep a
  Changelog form (`Added`/`Changed`/`Fixed`). Entries are user-facing:
  describe the visible change, not the implementation; skip internal
  refactors.
- `AGENTS.md` — build or test commands, conventions, or other
  agent-relevant facts changed.
- `docs/REQUIREMENTS.md` — testable behavior changed.
- `docs/ARCHITECTURE.md` — module boundaries, data flow, or a stated
  invariant changed.
- `docs/DEPLOY.md` — deploy steps, environment variables, or infra config
  changed.
- `docs/TESTING.md` — how tests are run or structured changed.
- `docs/decisions/` — a decision with lasting consequences was made: append
  a new numbered record; never rewrite old ones.

Create a doc only on its trigger, never speculatively:

- Graduation: a `README.md` section has outgrown roughly a screenful — move
  it to the matching `docs/` file and leave a link behind.
- First occurrence: `CHANGELOG.md` at the first release, `AGENTS.md` at the
  first agent-relevant fact worth recording, `docs/decisions/` at the first
  recorded decision.
