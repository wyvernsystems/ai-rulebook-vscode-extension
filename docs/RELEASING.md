# Releasing AI Rulebook

AI Rulebook ships as a `.vsix` extension package built locally and attached to
a GitHub release. CI (`.github/workflows/ci.yml`) runs `npm test` on every
push to `main` and every pull request. Releases are still cut locally; there
is no deploy server: a release is a version bump, a tag, and an uploaded artifact. This
document is the checklist.

## Prerequisites

- A supported Node.js release meeting the locked build dependencies. The
  installed `@vscode/vsce` requires Node.js 20 or newer. The extension
  declares `engines.node: >=18.18.0` and CI tests Node 18/20, but that older
  runtime declaration is not sufficient for packaging.
- A clean working tree on `main`, up to date with `origin/main`.
- [GitHub CLI](https://cli.github.com/) authenticated against the
  repository with an account allowed to publish releases: `gh auth status`.
- `@vscode/vsce` — already a dev dependency, so `npm ci` is enough. No
  global install required.
- For the optional marketplace step only: a Visual Studio Marketplace personal
  access token for the `WyvernSystemsLLC` publisher, supplied as the
  `VSCE_PAT` environment variable, and/or an [Open VSX](https://open-vsx.org)
  access token for the same namespace, supplied as `OVSX_PAT`. Never commit a
  token or paste it into a changelog, release note, or commit message.

## Versioning

The project follows [Semantic Versioning](https://semver.org/).

- **Major** — a rule is removed or renamed, or installed workspaces need
  manual migration.
- **Minor** — rules are added or their guidance changes, new commands or
  settings, new host integrations.
- **Patch** — fixes that change no rule text and add no configuration surface.

Three things must agree for every release, and the release is wrong if they
drift:

- `version` in `package.json`
- the newest released version heading in `CHANGELOG.md` (below `[Unreleased]`)
- the git tag, always formatted `vX.Y.Z`

The VSIX filename derives from `package.json`, so it becomes
`ai-rulebook-X.Y.Z.vsix` with no separate step.

## Release checklist

### 1. Preflight

```bash
git checkout main
git pull --ff-only
git status --short          # must be empty
npm ci
npm test
```

`npm test` compiles, runs `verify:bundled`, and runs the suite.
`verify:bundled` fails if `bundled/manifest.json` no longer lists exactly the
`.mdc` rules in `bundled/ai-rules/`, if any non-`.mdc` file is present,
if a rule is missing a `description`, or if it carries an unrenderable
placeholder. If you added, removed, or edited a rule file, run `npm run sync-bundled` to regenerate the
manifest and standalone files, then re-run `npm test`. Commit those changes
before cutting the release.

Rule text is edited in `bundled/ai-rules/`. This repo's own `AGENTS.md`
carries a rendered block as a dogfooded install; bundle generation uses the
source rules, not that installed block.

`npm run sync-bundled` also regenerates the standalone README and
`bundled/standalone/AGENTS.md`, the
file the extension writes into a fresh workspace, rendered by the compiled
`agentsMd` module. It is tracked in git so anyone can grab it without
installing the extension; commit it whenever a rule change leaves it stale.

### 2. Bump the version

```bash
npm version X.Y.Z --no-git-tag-version
```

The `--no-git-tag-version` flag matters: the tag is created later, after the
changelog and build artifacts are in the same commit. This updates both
`package.json` and `package-lock.json`.

Replace `X.Y.Z` in the commands below with the chosen version. README install
examples deliberately use `X.Y.Z`; no filename edit is needed there. Update
the README introduction and migration notes when a new release changes the
installation layout. Version 4.0.0 introduced the `AGENTS.md` migration.

### 3. Close the changelog

In `CHANGELOG.md`, rename the `## [Unreleased]` heading to
`## [X.Y.Z] - YYYY-MM-DD` using today's date, and open a fresh empty
`## [Unreleased]` above it. Keep the
[Keep a Changelog](https://keepachangelog.com/) section order: Added,
Changed, Deprecated, Removed, Fixed, Security.

The changelog is the source for the release notes in step 6. Write it for
someone deciding whether to upgrade, not as a commit log.

### 4. Verify and build

```bash
npm run test:coverage
npm run package
```

Record the test count and coverage percentages from `test:coverage` — the
release notes have quoted them since 2.0.0, and quoting numbers from a run
you did not do is exactly what `tests.mdc` forbids.

`npm run package` invokes `vsce package`, which first runs
`vscode:prepublish` (`sync-bundled`, which compiles, then `verify:bundled`).
Confirm it emits `ai-rulebook-X.Y.Z.vsix` at the repository root. The `.vsix`
is gitignored and is never committed; it exists only as a release asset.
`bundled/standalone/AGENTS.md` is refreshed by the same step; if it changed,
commit it in the release commit.

### 5. Commit and tag

```bash
git diff --stat
git add package.json package-lock.json CHANGELOG.md
# Stage any other release files explicitly after reviewing their diffs.
git diff --cached
git commit -m "Release vX.Y.Z" -m "Ship the documented changes and migration instructions for this release."
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Stage `README.md`, `bundled/manifest.json`, and the standalone files by name
if the release changed them. Do not stage unrelated work or release assets.

Push the branch before the tag so the tag always resolves to a commit that
exists on the remote.

### 6. Publish the GitHub release

```bash
gh release create vX.Y.Z \
  ai-rulebook-X.Y.Z.vsix \
  bundled/standalone/AGENTS.md \
  --title "AI Rulebook X.Y.Z" \
  --notes-file .github-release-notes-X.Y.Z.md
```

Conventions carried forward from earlier releases:

- Title is `AI Rulebook X.Y.Z` — no `v` prefix in the title, `v` prefix on the
  tag.
- The `.vsix` is attached as an asset, because that is how users install.
- `bundled/standalone/AGENTS.md` is attached alongside it, for anyone who
  wants just the rules without installing the extension.
- Notes lead with a short paragraph on why the release matters, then
  `## Highlights`, then an `## Upgrading` section whenever installed
  workspaces need an action.

Write the notes to a scratch file rather than passing them inline; the
gitignore already covers `.github-release-notes-*.md` for this purpose.

### 7. Publish to the marketplaces (optional)

GitHub is the primary distribution channel. Two marketplaces can additionally
carry the release, and both are published from the same `.vsix`. Using the
built artifact (`--packagePath` for vsce, the positional path for ovsx)
publishes the exact file attached to the GitHub release instead of rebuilding
it, so the channels cannot diverge.

**Visual Studio Marketplace** — reaches VS Code itself:

```bash
# Set VSCE_PAT securely in your environment before running this command.
npx vsce publish --packagePath ai-rulebook-X.Y.Z.vsix
```

**Open VSX** — reaches the hosts that default to the Open VSX registry
instead of Microsoft's (VSCodium, Windsurf, Gitpod, Eclipse Theia, and other
VS Code forks), which is most of the audience this extension targets:

```bash
# Set OVSX_PAT securely in your environment before running this command.
npx ovsx publish ai-rulebook-X.Y.Z.vsix
```

`ovsx` is a dev dependency, so `npm ci` provides it. One-time setup for
a new publisher: create an [Eclipse Foundation Open VSX](https://open-vsx.org)
account, generate the token there, and claim the namespace once with
`npx ovsx create-namespace WyvernSystemsLLC` with `OVSX_PAT` set.

## Hotfix releases

Fix forward on `main`. The extension has no long-lived support branches, and
users upgrade by installing a newer VSIX, so a patch release follows the same
checklist with a patch-level bump.

## Rollback

A published GitHub release can be withdrawn, but a version number is never
reused — increment the patch number, for example `4.0.0` → `4.0.1`.

```bash
gh release delete vX.Y.Z --yes     # removes the release, keeps the tag
git push --delete origin vX.Y.Z    # removes the tag, only if never advertised
```

Deleting a tag that people may already have fetched is worse than leaving a
superseded release in place. Prefer marking the old release as superseded in
its notes and publishing the fix.

## What ships in the VSIX

The current file list from `npx vsce ls` contains:

- `bundled/ai-rules/` and `bundled/manifest.json` — the rule pack the
  extension actually reads from at runtime. `bundled/standalone/` is excluded
  from the VSIX: it exists for the release asset in step 6, not for the
  extension itself.
- `out/` — compiled JavaScript. Sources, tests, scripts, and maps are excluded.
- `icon.png`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`.

`AGENTS.md`, `CLAUDE.md`, legacy rule folders, ZIP/VSIX archives, development
files, and the standalone pack are excluded. Workspace installation renders
the bundled source rules; it does not copy repository agent guidance.

`README.md` is the Marketplace description, so review how it reads before
packaging. After a build, confirm the contents with:

```bash
npx vsce ls
```
