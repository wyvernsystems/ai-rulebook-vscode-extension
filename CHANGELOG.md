# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Tests**: `tests/safePaths.test.mjs`, `tests/manifest.test.mjs`, and
  `tests/rulesOperations.test.mjs` cover path containment, manifest
  validation, core-rule toggle/install/reset, and Cline mirroring (`npm test`).
- **Generated rule folders stay local.** Install and Cline sync add
  `/.cursor/rules/ai-rules/` and `/.clinerules/ai-rules/` to the workspace
  `.gitignore`.

### Changed

- **Sidebar presentation refined.** The core rule uses a readable label,
  clearer tooltip, and consistent Enabled / Disabled wording. An
  empty-workspace welcome action opens a project folder.
- **Theme-aware UI palette.** New configurable enabled and disabled color
  tokens keep sidebar and Explorer styling consistent across light, dark, and
  high-contrast themes.
- **Rule pack compressed to one file.** `core.mdc` is always on and combines
  stable dependencies, reuse, feature organization, unit tests and coverage,
  project-document upkeep, and Markdown conventions.
- **Core guidance made actionable.** Requirements now define applicability,
  scoped changes, verification reporting, and baseline input and secret safety.
- **Clean compilation.** `npm run compile` removes stale `out/` files before
  rebuilding so deleted modules cannot enter the VSIX.
- **README simplified.** Setup, commands, rule location, and development steps
  now fit in a short quick-reference guide.

### Removed

- Role, mode, testing, documentation, context, security, and rule-authoring
  rule files and their mode commands. Their essential constraints now live in
  `core.mdc`.
- Empty category folders, redundant global-mirror and one-item toggle commands,
  and the duplicated `ABOUT_RULES.md`.

## [1.4.0] - 2026-05-05

### Added

- **`context-rules/`** folder: `dense-session-handoff-context.mdc` (@-mention)
  for a single paste-ready dense session summary; `low-token-session-habits.mdc`
  for terse long-session behavior when enabled.
- **Mode — Low token** (`aiRules.modeLowToken`): enables only the minimal rule
  subset for token-efficient long sessions (toolbar + command palette).
- **Tests**: `tests/modes.test.mjs` runs under `node --test` against compiled
  output (`npm test`). No new dependencies—uses Node's built-in test runner.

### Changed

- **Compressed** shipped `.mdc` rules for smaller context footprint without
  dropping core constraints.
- **Mode — Build** is lighter by default: turns **off** all `rules-for-rules/*`
  and **off** the secure-code coding rule only (documentation rules +
  `write-clean-code` + `organize-repository-by-feature` + `reuse` +
  `remove-dead-code` + `prefer-LTS` stay on). **Plan** and **Test** restore the
  full coding + meta set.
- **Lower `alwaysApply` footprint**: `update-changelog-for-notable-changes`
  and `append-and-deduplicate-requirements` now scope to their target file
  via `globs`; `evolve-rules-when-codebase-patterns-change` scopes to
  `**/.cursor/rules/ai-rules/**/*.mdc`.
- **`write-clean-code`** absorbs a one-line security baseline (no secrets,
  validate input, parameterized queries) so Build retains baseline guardrails
  even with `secure-code-data-and-dependencies` off.
- **`state-active-project-rules-in-prompt-response`** body trimmed.
- **`modes.ts`**: `MODE_PROFILES` replaced with `getModeProfile(mode, allMdcs)`;
  Low-token's disable list is now derived from the loaded manifest instead of a
  hand-maintained constant. Removed `EVERY_PACK_MDC`.
- **README** points to `bundled/ai-rules/ABOUT_RULES.md` for per-rule and
  per-mode detail; previous duplicated tables were removed.
- **`npm run sync-bundled`**: manifest lists logical `*.mdc` paths even when the
  workspace ships only `*.mdc.disabled`; install / Cline sync resolve the file
  variant on disk.

### Removed

- `coding-rules/verify-syntax-and-fix-before-finishing.mdc` (modern AIs handle
  syntax checking inline; the rule no longer earned its tokens).

## [1.3.1] - 2026-04-30

### Changed

- **Marketplace icon refined.** Regenerated `icon.png` from a cleaner
  background-removed source. Pure black is mapped to transparent with a
  soft 25→80 luminance ramp for the glow halo (no alpha-unblending), so
  the cyan glow stays vibrant and the dark book pages remain readable
  on light themes. `icon-source.png` updated locally; still gitignored
  and excluded from the VSIX.

## [1.3.0] - 2026-04-30

### Added

- **Host detection.** New `src/cursor.ts` exposes `isCursorHost()`, which
  returns `true` when `vscode.env.uriScheme === "cursor"` or
  `vscode.env.appName` contains `"cursor"` (case-insensitive). Symmetric
  with the existing Cline detection in `src/cline.ts`.
- **`aiRules.installCursorRulesFolder` setting.** Tri-state policy
  controlling the `.cursor/rules/ai-rules/` auto-install:
  - `"auto"` (default): only when the host is Cursor.
  - `"always"`: always (existing behavior; useful when committing rules
    for Cursor-using teammates from plain VS Code).
  - `"never"`: never. Manual install / reset / sidebar commands still
    work.
- **One-time non-Cursor host notice.** When the policy resolves to skip
  the auto-install, the user sees a single info toast with "Install now",
  "Open setting", and "Dismiss" actions. Persisted via `globalState` so
  it never repeats per machine.

### Changed

- **Auto-install split into Cursor and Cline tracks.** Cline mirroring
  (`.clinerules/ai-rules/`) is now independent of the Cursor folder
  install: a Cline user on plain VS Code still gets `.clinerules/ai-rules/`
  even when `.cursor/rules/ai-rules/` is skipped.
- **Marketplace icon refreshed** with a new open-book design (binary +
  graph + AI / gavel motif). White background removed (transparent
  alpha) so the icon looks correct on both light and dark themes. The
  high-resolution master is preserved locally as `icon-source.png`
  (gitignored, excluded from the VSIX).

### Unchanged

- All command IDs, settings names already in use, view IDs, and on-disk
  layouts (`.cursor/rules/ai-rules/`, `bundled/ai-rules/`,
  `.clinerules/ai-rules/`, `<globalStorage>/ai-rules-mirror/ai-rules/`)
  are unchanged. Existing keybindings, settings overrides, and rule
  folders keep working without migration.

## [1.2.0] - 2026-04-29

### Renamed

- **Package name**: `ai-rules` → `ai-rulebook` in `package.json`. The
  Marketplace package id is now **`WyvernSystemsLLC.ai-rulebook`** (was
  `WyvernSystemsLLC.ai-rules`), and `vsce package` produces
  `ai-rulebook-<version>.vsix` (e.g. `ai-rulebook-1.2.0.vsix`) instead of
  `ai-rules-<version>.vsix`. README and REQUIREMENTS updated to reflect
  the new id. No prior public Marketplace release used the old id, so
  this is a no-op for end users.

### Unchanged (stable contracts)

- On-disk rules layout stays `.cursor/rules/ai-rules/` and
  `bundled/ai-rules/`. Cline mirror stays `.clinerules/ai-rules/`. Global
  mirror stays `<globalStorage>/ai-rules-mirror/ai-rules/`. Command IDs
  stay `aiRules.*`, settings stay `aiRules.*`, view IDs stay
  `aiRules.rulesTree` / `aiRulesSidebar`. Existing keybindings, settings
  overrides, and on-disk rule folders keep working without migration.

## [1.1.1] - 2026-04-29

### Changed

- **Repository URL updated.** `package.json` `homepage`, `bugs.url`, and
  `repository.url` now point at
  `https://github.com/wyvernsystems/ai-rulebook-vscode-extension` (the repo
  was renamed from `cursor-rules-vscode-extension`). Marketplace package id
  (`WyvernSystemsLLC.ai-rules`), command IDs, settings, view IDs, and the
  on-disk rules layout are unchanged.

## [1.1.0] - 2026-04-29

### Changed

- **Renamed extension display: `AI Rules` → `AI Rulebook`.** All
  user-visible strings updated:
  - `package.json`: `displayName`, `description`, `keywords` (added
    `rulebook` and `ai-rules`), every command `title` / `category`, the
    activity-bar view container `title`, the rules tree
    `contextualTitle`, and the `configuration.title` block.
  - Every information / warning / error toast in `src/extension.ts`,
    `src/sidebarTreeView.ts`, and `src/ruleStatusUi.ts` now says
    "AI Rulebook" instead of "AI Rules".
  - The "AI Rules" Output channel is now "AI Rulebook".
  - `README.md`, `REQUIREMENTS.md`, and `bundled/ai-rules/ABOUT_RULES.md`
    refer to the extension as **AI Rulebook**.
- **Internal contracts unchanged.** The install slug stays `ai-rules`
  (Marketplace id remains `WyvernSystemsLLC.ai-rules`), command IDs stay
  `aiRules.*`, settings stay `aiRules.*`, view IDs stay
  `aiRules.rulesTree` / `aiRulesSidebar`, and the on-disk rules layout
  stays `.cursor/rules/ai-rules/` and `bundled/ai-rules/`. Any existing
  keybindings, settings overrides, and on-disk rule folders keep working.

## [1.0.2] - 2026-04-29

### Changed

- **Publisher renamed** `wyvernsystems` → `WyvernSystemsLLC` in
  `package.json` to match the actual VS Code Marketplace publisher account.
  The Marketplace package id is now **`WyvernSystemsLLC.ai-rules`**. README
  and REQUIREMENTS updated to reflect the new id. No prior public
  Marketplace release used the old id (uploads were rejected with a
  publisher-mismatch error), so this is a no-op for end users.

## [1.0.1] - 2026-04-29

### Fixed

- **`AI Rules: Hide active rules` did nothing when a Workspace-level
  `aiRules.colorRulesInExplorer` setting existed.** The command always wrote
  to `ConfigurationTarget.Global` (User scope), which is shadowed by any
  Workspace or Folder override—so the effective value never flipped to
  `false` and the green tint stayed. Both `Hide active rules` and
  `Show active rules` now write to whichever scope is currently overriding
  the value (folder > workspace > user) via `WorkspaceConfiguration.inspect`.
- Both commands now also call `explorerColors.refresh()` directly after the
  setting update, so the Explorer's decoration cache re-queries even if the
  `onDidChangeConfiguration` listener is debounced.

## [1.0.0] - 2026-04-29

First **stable** release. Marketplace listing, packaging, and rule pack
considered ready for general use. No breaking changes versus 0.5.0—command
IDs, settings, and on-disk format are stable.

### Added

- **`AI Rules: Hide active rules (no green)`** command. Sets
  `aiRules.colorRulesInExplorer` to `false` at the User scope so the green
  / muted tint disappears from the workbench Explorer. The AI Rules
  sidebar tree's colors are deliberately unaffected—the sidebar exists to
  surface on / off state, so removing color there would defeat its
  purpose.
- The companion `AI Rules: Show active rules` command now also flips
  `aiRules.colorRulesInExplorer` back to `true` (idempotent—no-op if
  already on) so the pair behaves symmetrically.
- Both commands are surfaced in the sidebar title-bar overflow menu under
  the **Inspect** group.

## [0.5.0] - 2026-04-29

### Added

- **Explorer file-name coloring.** A new `WorkspaceRuleFileColorer`
  (`vscode.FileDecorationProvider`) tints `.mdc` files green and
  `.mdc.disabled` files muted gray in VS Code's built-in Explorer (and
  any other view that renders real `file://` URIs), for any rule under
  `.cursor/rules/ai-rules/` in the open workspace. Sibling to the existing
  sidebar tree decoration, which uses synthetic URIs.
- New setting `aiRules.colorRulesInExplorer` (default `true`) opts out of
  the Explorer coloring without affecting the AI Rules sidebar.
- Listening for `onDidChangeConfiguration` so flipping the setting
  re-publishes decorations without a reload.

### Changed

- **Renamed command** `AI Rules: Show pack status (green = active)` →
  `AI Rules: Show active rules (green = active)`. Command ID stays
  `aiRules.showPackStatus` so existing keybindings keep working. README,
  sidebar overflow menu, and changelog references updated.
- `RulesTreeProvider` now exposes a generic `onAfterRefresh(cb)` hook (used
  by both decoration providers) instead of the previous one-off
  `setDecorationProvider` setter.

## [0.4.0] - 2026-04-29

### Added

- **Auto-Build mode on first install.** The first-time auto-install now
  finishes by applying the **Build** mode profile: `role-developer` is
  enabled and the other roles + every `test-rules/*` start disabled. Users
  who want a different default can flip modes from the sidebar title bar.
- **Colored sidebar rule labels.** A new `FileDecorationProvider` paints
  active rule labels in green (`testing.iconPassed`) and disabled rule
  labels in muted gray (`disabledForeground`), so on / off state is obvious
  in the sidebar tree without reading the description column.
- **README** got a dedicated **Sidebar tree view — turn rules on and off**
  section explaining the title-bar buttons, folder row actions, rule
  checkboxes, and the `Show pack status` flow.

### Changed

- **`AI Rules: Show pack status`** now focuses the AI Rules sidebar (where
  the colored state lives) and writes a plain-text log to **Output → AI
  Rules** alongside it, instead of dumping ANSI escape codes that VS Code's
  Output panel does not render. The Output channel is no longer auto-popped
  on every install / mode change.

## [0.3.0] - 2026-04-29

### Added

- **Auto-install on first open.** When the extension activates in a workspace
  that does not yet have `.cursor/rules/ai-rules/`, it now drops the bundled
  rule pack into the workspace automatically (and mirrors to Cline if
  applicable). Existing rules folders are never overwritten — use the
  explicit **Install / update** or **Reset** commands for that. Re-runs on
  `onDidChangeWorkspaceFolders` so newly added folders pick up the pack.
- New setting `aiRules.autoInstallOnOpenWorkspace` (default `true`) to opt
  out of the auto-install.

### Changed

- **README reorder**: `## All commands`, `## Modes`, and `## Settings` now
  appear above `## Every rule that ships with this extension`, so a new user
  sees how to operate the extension before scrolling through the per-rule
  table. Quickstart updated to describe the new auto-install behavior.

## [0.2.0] - 2026-04-29

First Marketplace release.

### Renamed

- **Package name**: `wyvern-ai-rules` → `ai-rules`. The Marketplace
  package id is now `wyvernsystems.ai-rules` (publisher unchanged), and
  `vsce package` produces `ai-rules-<version>.vsix` (e.g.
  `ai-rules-0.2.0.vsix`) instead of `wyvern-ai-rules-<version>.vsix`. No
  prior public release used the old id.

### Added

- **Plain-English README** that doubles as the Marketplace description: an
  intro that explains what AI rules are and why to use them, the full per-rule
  table grouped by subfolder, every command (in plain English), every mode,
  every setting, and a *Limitations* section covering context-window pressure
  and rule-firing caveats.
- **`REQUIREMENTS.md`** capturing the working functional requirements,
  non-functional constraints (license, no network, no runtime deps, security
  invariants, VSIX contents), and explicit non-goals.
- **Sidebar tree view** (`AI Rules: Rules`) contributed under a new activity-bar
  view container `aiRulesSidebar`:
  - Subfolder → rule hierarchy with a real **TreeItem checkbox** per rule that
    flips `<name>.mdc` ↔ `<name>.mdc.disabled` via the existing rename helper.
  - Click a rule's label to open the `.mdc` file in the editor.
  - View title actions for **Plan / Build / Test / Role…** modes plus a
    refresh icon; overflow includes bulk install / enable-all / disable-all /
    reset / show-pack-status.
  - Folder rows expose inline **Enable / Disable** actions that toggle every
    rule under the selected subfolder.
- New commands wiring the sidebar: `aiRules.refreshTree`,
  `aiRules.revealRuleFile`, `aiRules.enableFolder`, `aiRules.disableFolder`.
- New module `src/sidebarTreeView.ts` (`RulesTreeProvider`,
  `bindRulesTreeView`, `RULES_TREE_VIEW_ID`).
- **Role rules** (`.cursor/rules/ai-rules/role-rules/`) — 8 audience-framing
  rules, off by default, toggled by the new mode commands:
  `role-developer.mdc`, `role-architect.mdc`, `role-tester.mdc`,
  `role-cyber-expert.mdc`, `role-product-manager.mdc`, `role-beginner.mdc`,
  `role-expert.mdc`, `role-end-user.mdc`.
- **Test rules** (`.cursor/rules/ai-rules/test-rules/`) — 5 testing playbooks,
  off by default, enabled together by `Mode — Test`:
  `write-unit-tests.mdc`, `write-smoke-tests.mdc`,
  `write-regression-tests.mdc`, `write-integration-tests.mdc`,
  `write-end-to-end-tests.mdc`.
- **Mode commands**:
  - `AI Rules: Mode — Plan` (architect role, no test rules)
  - `AI Rules: Mode — Build` (developer role, no test rules)
  - `AI Rules: Mode — Test` (tester role + every test rule)
  - `AI Rules: Mode — Role…` (QuickPick: enable one role, disable the others)
- New module `src/modes.ts` defining the mode preset shape and helpers
  (`applyModeProfile`, `applyRolePick`, `MODE_PROFILES`, `ROLE_RULES`,
  `TEST_RULES`).
- New module `src/safePaths.ts` — `isSafeManifestEntry`,
  `assertContainedPath`, `assertSafeDeletionTarget` — used at every boundary
  that resolves a manifest entry under a base directory.
- **`LICENSE`** (MIT) at the repo root, shipped in the VSIX.
- **`icon.png`** (128×128) at the repo root for the Marketplace listing.
  Hi-res master kept locally as `icon-source.png` (excluded from the VSIX
  and from git).

### Changed

- **Rule pack: simplified and deduped.** Every rule under
  `.cursor/rules/ai-rules/` rewritten as a tighter, scannable bullet list so
  models with limited context can honor every active rule. Cross-rule overlap
  removed.
- **Rename**: `rules-for-rules/state-active-project-rules.mdc` →
  `rules-for-rules/state-active-project-rules-in-prompt-response.mdc`. Body
  reduced to a "print a bullet list of active rule paths" instruction so the
  rendered `### Active project rules` block stays short and accurate when
  rules are toggled.
- **`src/extension.ts`** routes all destructive / copy operations through
  helpers in `src/rulesOperations.ts` (`copyManifestFiles`,
  `replaceGlobalMirror`, `removeGlobalMirror`) instead of inline `fs.rm` /
  `fs.cp` calls.
- **Marketplace metadata** filled in: `license: MIT`, `icon: icon.png`,
  `homepage`, `bugs`, `keywords`, `engines.node ≥ 18.18.0`, repo URL switched
  to `git+https://...` form for `vsce` compatibility. `package.json#files`
  removed (vsce 3.x requires `.vscodeignore` instead).
- **`.vscodeignore`** tightened: source, scripts, lockfiles, build info,
  hi-res icon source, and `*.vsix` excluded from the packaged extension.
  Only compiled JS, bundled rules, the 128×128 icon, README, CHANGELOG, and
  LICENSE are shipped.
- **`.gitignore`** ignores `*.tsbuildinfo` and `icon-source.png`.
- Reorganized the rule pack into five subfolders inside
  `.cursor/rules/ai-rules/`: `coding-rules/`, `documentation-rules/`,
  `role-rules/`, `rules-for-rules/`, `test-rules/`.
- `mdc:` cross-links and `state-active-project-rules.mdc` template updated
  to use the subfolder paths.
- Dropped the duplicate "Duplication: extract on third repetition" bullet
  from `coding-rules/write-clean-code.mdc` (covered by
  `coding-rules/reuse-code-before-duplicating.mdc`).

### Removed

- `rules-for-rules/maintain-cursor-rules.mdc` — content folded into
  `rules-for-rules/write-cursor-rules-for-this-project.mdc`, which is now the
  single source for both authoring and ongoing maintenance / deprecation
  guidance for rule files. Both rules previously shared the same `globs`
  scope and overlapping content.

### Security

- **Validated bundled manifest at load.** `src/manifest.ts` now schema-checks
  `bundled/manifest.json`: rejects missing fields, non-array `files`, and
  any entry that fails the safe-path predicate (`^[A-Za-z0-9_./-]+$`, no
  `..`, no leading `/` or `./`, ≤ 200 chars). A tampered manifest aborts
  activation with a clear error instead of being trusted.
- **Path containment checks** on every operation that resolves a manifest
  entry under a base directory (bundle, workspace rules dir, global mirror,
  Cline mirror).
- **Destructive operations gated by suffix assertions.**
  `resetRulesDirToBundle` refuses to delete a path that doesn't end with
  `.cursor/rules/ai-rules`; `replaceGlobalMirror` / `removeGlobalMirror`
  refuse paths not ending with `ai-rules-mirror/ai-rules`.
- **Recursive copies refuse symlinks.** The `fs.cp(...)` calls that mirror
  the bundle into the workspace and global storage now use a `filter`
  callback that skips symbolic links. The directory walker in
  `deleteUnshippedFiles` also skips symlinks.
- **Hardened `aiRules.revealRuleFile` arguments**: rejects non-string args,
  unsafe shapes, and any `rulePath` not present in the validated manifest
  before resolving / opening.
- **Friendlier failure surface**: if `bundled/manifest.json` is missing or
  invalid, the user sees the underlying reason in the error toast instead
  of a generic "missing copy" string.

### Fixed

- `scripts/sync-bundled.mjs` walks recursively when generating
  `bundled/manifest.json`, so manifest paths include subfolders (e.g.
  `coding-rules/write-clean-code.mdc`).
- `src/rulesOperations.ts`:
  - `installBundleToRulesDir` and `setRuleEnabled` create parent
    directories before copying or renaming, so subfolder rules install and
    toggle correctly.
  - `deleteUnshippedFiles` walks the rules directory recursively when
    checking which files are part of the bundle.
  - The Cline mirror writer flattens any subfolder path into the output
    filename (`ai-rules-coding-rules-write-clean-code.md`) to avoid
    collisions and keep `.clinerules/ai-rules/` flat.
  - `EVOLVE_RULE` points at
    `rules-for-rules/evolve-rules-when-codebase-patterns-change.mdc`.
- `ABOUT_RULES.md` and `README.md` describe the current layout.
