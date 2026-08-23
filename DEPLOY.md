# Deploying AI Rulebook

AI Rulebook ships as a `.vsix` extension package built locally and attached to
a GitHub release. There is no CI pipeline and no deploy server: a release is a
version bump, a tag, and an uploaded artifact. This document is the checklist.

## Prerequisites

- Node.js 18.18 or newer (the value in `engines.node`). Use the same major
  version you develop against.
- A clean working tree on `main`, up to date with `origin/main`.
- [GitHub CLI](https://cli.github.com/) authenticated against the
  `wyvernsystems` account with `repo` scope: `gh auth status`.
- `@vscode/vsce` — already a dev dependency, so `npm install` is enough. No
  global install required.
- For the optional Marketplace step only: a Visual Studio Marketplace personal
  access token for the `WyvernSystemsLLC` publisher, supplied as the
  `VSCE_PAT` environment variable. Never commit it or paste it into a
  changelog, release note, or commit message.

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
- the top section heading in `CHANGELOG.md`
- the git tag, always formatted `vX.Y.Z`

The VSIX filename derives from `package.json`, so it becomes
`ai-rulebook-X.Y.Z.vsix` with no separate step.

## Release checklist

### 1. Preflight

```bash
git checkout main
git pull --ff-only
git status --short          # must be empty
npm install
npm test
```

`npm test` compiles, runs `verify:bundled`, and runs the suite. It fails if
`bundled/ai-rules/` has drifted from `.cursor/rules/ai-rules/`, which is the
most common reason a release build breaks. If you edited rule text, run
`npm run sync-bundled` and re-run `npm test`.

### 2. Bump the version

```bash
npm version X.Y.Z --no-git-tag-version
```

The `--no-git-tag-version` flag matters: the tag is created later, after the
changelog and build artifacts are in the same commit. This updates both
`package.json` and `package-lock.json`.

Then update the VSIX filename in the install example in `README.md` so the
documented command matches the artifact people will download.

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
`vscode:prepublish` (`sync-bundled`, `verify:bundled`, `compile`). Confirm it
emits `ai-rulebook-X.Y.Z.vsix` at the repository root. The `.vsix` is
gitignored and is never committed; it exists only as a release asset.

### 5. Commit and tag

```bash
git add -A
git commit -m "Release vX.Y.Z."
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Push the branch before the tag so the tag always resolves to a commit that
exists on the remote.

### 6. Publish the GitHub release

```bash
gh release create vX.Y.Z ai-rulebook-X.Y.Z.vsix \
  --title "AI Rulebook X.Y.Z" \
  --notes-file <notes.md>
```

Conventions carried forward from earlier releases:

- Title is `AI Rulebook X.Y.Z` — no `v` prefix in the title, `v` prefix on the
  tag.
- The `.vsix` is attached as an asset, because that is how users install.
- Notes lead with a short paragraph on why the release matters, then
  `## Highlights`, then an `## Upgrading` section whenever installed
  workspaces need an action.

Write the notes to a scratch file rather than passing them inline; the
gitignore already covers `.github-release-notes-*.md` for this purpose.

### 7. Publish to the Marketplace (optional)

GitHub is the primary distribution channel. To also push to the Visual Studio
Marketplace:

```bash
VSCE_PAT=<token> npx vsce publish --packagePath ai-rulebook-X.Y.Z.vsix
```

Using `--packagePath` publishes the exact artifact attached to the GitHub
release instead of rebuilding it, so the two channels cannot diverge.

## Hotfix releases

Fix forward on `main`. The extension has no long-lived support branches, and
users upgrade by installing a newer VSIX, so a patch release follows the same
checklist with a patch-level bump.

## Rollback

A published GitHub release can be withdrawn, but a version number is never
reused — ship `X.Y.Z+1` instead.

```bash
gh release delete vX.Y.Z --yes     # removes the release, keeps the tag
git push --delete origin vX.Y.Z    # removes the tag, only if never advertised
```

Deleting a tag that people may already have fetched is worse than leaving a
superseded release in place. Prefer marking the old release as superseded in
its notes and publishing the fix.

## What ships in the VSIX

`.vscodeignore` excludes everything except the runtime payload:

- `bundled/` — the rule pack and its manifest, the only reason the extension
  exists.
- `out/` — compiled JavaScript. Sources, tests, scripts, and maps are excluded.
- `icon.png`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`.

`README.md` is the Marketplace description, so review how it reads before
packaging. After a build, confirm the contents with:

```bash
npx vsce ls
```
