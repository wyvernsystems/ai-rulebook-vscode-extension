# Requirements

This document captures the working requirements, constraints, and non-goals
for the **AI Rulebook** extension. Short, testable bullets only — implementation
details belong in the code or in the rule files.

## Functional

- The extension installs six always-on topic rules (`scope.mdc`, `code.mdc`,
  `tests.mdc`, `docs.mdc`, `markdown.mdc`, and `git.mdc`) into
  `.cursor/rules/ai-rules/` of the open workspace. Each rule has
  `alwaysApply: true` and is installed enabled by default.
- The extension does **not** modify the workspace `.gitignore`. Installed
  rule folders are left unignored so they can be committed and shared.
- On activation (and on `onDidChangeWorkspaceFolders`), if the workspace has
  no `.cursor/rules/ai-rules/` folder yet, the extension installs the bundled
  rule pack automatically. Existing rules folders are never overwritten by
  the auto-install path. The behavior is gated by
  `aiRules.autoInstallOnOpenWorkspace` (default `true`).
- The `.cursor/rules/ai-rules/` auto-install is further gated by
  `aiRules.installCursorRulesFolder`, a tri-state setting:
  - `"auto"` (default): create the folder only when the host application is
    Cursor. Detected via `vscode.env.uriScheme === "cursor"` or
    `vscode.env.appName` containing `"cursor"` (case-insensitive).
  - `"always"`: create the folder regardless of host.
  - `"never"`: never auto-install. Manual install / reset / sidebar
    commands still work.
- When the resolved policy skips the auto-install, the extension shows a
  one-time informational toast on non-Cursor hosts ("Install now",
  "Open setting", "Dismiss"). The notice is persisted via `globalState`
  under `aiRules.nonCursorHostNoticeShown` so it never repeats per machine.
- Cline mirroring (`.clinerules/ai-rules/`) is independent of the Cursor
  install policy: it runs whenever Cline is installed and
  `aiRules.autoSyncClineWhenInstalled` is on, even if the `.cursor/` folder
  is skipped.
- The sidebar tree view colors active rule labels green and disabled rule
  labels red (via a `FileDecorationProvider`) so on / off state is visible
  without reading the description column.
- The same green / red scheme is applied to rule files in VS Code's built-in
  Explorer: `<name>.mdc` / `<name>.mdc.disabled` under
  `.cursor/rules/ai-rules/` and `<name>.md` / `<name>.md.disabled` under
  `.clinerules/ai-rules/`, `.opencode/rules/ai-rules/`, or
  `.claude/rules/ai-rules/` in the open workspace. Files that merely end in
  `.md` elsewhere are not tinted. Gated by `aiRules.colorRulesInExplorer`
  (default `true`).
- A status bar item shows the enabled-rule count for the first workspace
  folder (`AI 5/6`) plus the opencode config sync state (`✓` synced, `✗`
  skipped). Clicking it runs `AI Rulebook: Sync rule pack to opencode`. It is
  populated on activation and refreshed after every action that changes rule
  state.
- A pair of commands toggles the Explorer tint at the User scope without
  touching the sidebar:
  - `AI Rulebook: Hide rule colors` sets
    `aiRules.colorRulesInExplorer` to `false`.
  - `AI Rulebook: Show rule pack status` sets it back to `true`
    (idempotent), focuses the sidebar, and writes a plain-text snapshot to
    the Output channel.
- Source of truth for rule text is `bundled/ai-rules/`, the copy shipped in
  the VSIX. The workspace copy at `.cursor/rules/ai-rules/` is a generated,
  gitignored install that the extension renders per project, so it is not
  byte-identical to the source and is absent on a fresh clone.
- `npm run verify:bundled` must pass before packaging. It checks that
  `bundled/manifest.json` lists exactly the rules in `bundled/ai-rules/`, that
  every rule has a `description` in its frontmatter, and that no rule carries
  a placeholder the extension cannot render.
- `npm run sync-bundled` regenerates both `bundled/manifest.json` and
  `bundled/rule-packs/` (`cursor/`, `cline/`, `opencode/`, `claude-code/`),
  each a ready-to-copy `ai-rules/` folder rendered from `bundled/ai-rules/`
  using the same conversion rules as the corresponding workspace mirror
  (`{{TEST_COMMAND}}` rendered as generic prose, since there is no project).
  These folders are tracked in git — unlike the gitignored workspace
  mirrors — so someone can browse or grab a tool's rules directly from the
  repo without installing the extension. They are excluded from the VSIX
  itself (`.vscodeignore`) since the extension only ever reads from
  `bundled/ai-rules/`.
- `npm run package-rule-packs` zips each `bundled/rule-packs/<tool>/` folder
  into `ai-rulebook-rules-<tool>-X.Y.Z.zip` at the repository root, for
  attaching to a GitHub release alongside the `.vsix` (see DEPLOY.md). The
  zips are gitignored build artifacts, not tracked.
- The bundled rules constrain task scope, code reuse and organization,
  dependency choices, input and error safety, testing integrity, triggered
  documentation updates, Markdown formatting, and unrequested Git mutations.
- The `AI Rulebook: Rule Pack` sidebar view lists every topic rule with a
  checkbox that toggles `<name>.mdc` ↔ `<name>.mdc.disabled`.
- Command-palette actions enable or disable one selected topic rule, and
  separate actions enable or disable the complete rule pack.
- When Cline is installed (`saoudrizwan.claude-dev` or
  `saoudrizwan.cline-nightly`) and `aiRules.autoSyncClineWhenInstalled` is
  on, the extension mirrors each topic rule into `.clinerules/ai-rules/` as
  `ai-rules-<topic>.md` after install, reset, manual sync, and first
  detection. In a multi-root workspace this mirroring, the opencode and
  Claude Code mirroring, and their manual sync commands (`AI Rulebook: Sync
  rule pack to Cline` / `...to opencode` / `...to Claude Code`) run
  independently in every open folder — each folder is judged on its own
  evidence and its own Cursor rule state. Only the `.cursor/rules/ai-rules/`
  install itself (auto-install, `AI Rulebook: Install / update rule pack`,
  and the sidebar) is scoped to the first workspace folder.
- The Cline mirror reflects the workspace's Cursor rule state: enabled rules
  are written as `ai-rules-<topic>.md`, disabled rules as
  `ai-rules-<topic>.md.disabled` (Cline only reads `.md` files, so disabled
  mirrors are skipped). Sidebar checkbox toggles and the enable /
  disable-all commands update the mirror immediately when Cline is
  installed and `aiRules.autoSyncClineWhenInstalled` is on. When the
  workspace has no Cursor rules folder, every Cline rule defaults to
  enabled.
- opencode mirroring (`.opencode/rules/ai-rules/`) is independent of the
  Cursor install policy: when the workspace shows evidence of opencode usage
  (an `AGENTS.md`, an `opencode.json` / `opencode.jsonc`, or a `.opencode/`
  folder) and `aiRules.autoSyncOpencodeWhenInstalled` is on, the extension
  mirrors each topic rule into `.opencode/rules/ai-rules/` as `<topic>.md`
  with the Cursor frontmatter stripped, and registers
  `.opencode/rules/ai-rules/*.md` in the `instructions` array of the
  project's opencode config (root `opencode.json`, then `opencode.jsonc`,
  then `.opencode/opencode.json`; the last is created when none exists).
  The config edit preserves JSONC comments and trailing commas; a config
  that cannot be parsed safely is left untouched and the user is warned —
  whether the sync ran automatically on workspace open or via the manual
  command.
- Syncing to opencode also writes a `/ai-rulebook` command file to
  `.opencode/command/ai-rulebook.md` that lists the active and disabled
  rules from `.opencode/rules/ai-rules/`, so opencode users can inspect rule
  state without opening VS Code. `AI Rulebook: Remove opencode rules` and
  `AI Rulebook: Remove all rule packs` delete it alongside the rule mirror.
- The `AI Rulebook: Sync rule pack to opencode` command runs the opencode
  mirror manually, regardless of the auto-sync gate.
- The opencode mirror reflects the workspace's Cursor rule state: enabled
  rules are written as `<topic>.md`, disabled rules as
  `<topic>.md.disabled` (the `*.md` instructions glob skips them). Sidebar
  checkbox toggles and the enable / disable-all commands update the mirror
  immediately when opencode evidence exists and
  `aiRules.autoSyncOpencodeWhenInstalled` is on. When the workspace has no
  Cursor rules folder, every opencode rule defaults to enabled.
- Claude Code mirroring (`.claude/rules/ai-rules/`) is independent of the
  Cursor install policy: when the workspace shows evidence of Claude Code
  usage (a `CLAUDE.md`, a `CLAUDE.local.md`, or a `.claude/` folder) and
  `aiRules.autoSyncClaudeWhenInstalled` is on, the extension mirrors each
  topic rule into `.claude/rules/ai-rules/` as `<topic>.md` with the Cursor
  frontmatter converted: a rule's `globs` pattern becomes Claude's `paths:`
  frontmatter list, and a rule with no `globs` is written frontmatter-free.
  Claude Code auto-discovers every `.md` file under `.claude/rules/`, so no
  config file is registered or edited.
- The `AI Rulebook: Sync rule pack to Claude Code` command runs the Claude
  Code mirror manually, regardless of the auto-sync gate.
- The `AI Rulebook: Sync rule pack to Cursor` command refreshes
  `.cursor/rules/ai-rules/` from the bundled copy manually, regardless of
  host application or `aiRules.installCursorRulesFolder`.
- The `AI Rulebook: Sync rule pack to all formats` command writes every
  supported mirror (Cursor, Cline, opencode, and Claude Code) in one step,
  ignoring every auto-sync gate.
- Remove commands delete `.cursor/rules/ai-rules/`, `.clinerules/ai-rules/`,
  `.opencode/rules/ai-rules/`, or `.claude/rules/ai-rules/` individually, or
  all four at once after a confirmation dialog. Removing opencode rules does
  not edit the opencode config `instructions` array.
- Manual sync and remove commands are exposed in the Rule Pack sidebar under
  **Sync rule packs** and **Remove rule packs** submenus. None are hidden
  based on whether the host is Cursor or plain VS Code.
- The Claude Code mirror reflects the workspace's Cursor rule state: enabled
  rules are written as `<topic>.md`, disabled rules as `<topic>.md.disabled`
  (Claude Code only auto-loads `.md` files, so disabled mirrors are skipped).
  Sidebar checkbox toggles and the enable / disable-all commands update the
  mirror immediately when Claude Code evidence exists and
  `aiRules.autoSyncClaudeWhenInstalled` is on. When the workspace has no
  Cursor rules folder, every Claude Code rule defaults to enabled.

## Non-functional

- **License**: MIT. A `LICENSE` file ships in the VSIX.
- **Publisher**: `WyvernSystemsLLC`. Marketplace package id
  `WyvernSystemsLLC.ai-rulebook`.
- **Engines**: VS Code `^1.85.0`, Node `>=18.18.0`.
- **No runtime dependencies.** Only `@types/*`, `@vscode/vsce`, and
  `typescript` as devDependencies.
- **No network access.** The extension must never make outbound HTTP calls.
- **No secret material.** The extension must never read or write credentials,
  tokens, environment variables, or anything outside its allowed paths.
- The extension only writes inside two well-known locations:
  - the open workspace, under `.cursor/rules/ai-rules/`, (with Cline)
    `.clinerules/ai-rules/`, (with opencode) `.opencode/rules/ai-rules/`, and
    (with Claude Code) `.claude/rules/ai-rules/`;
  - the workspace's opencode config file (root `opencode.json` /
    `opencode.jsonc` / `.opencode/opencode.json`), limited to adding the
    generated `instructions` entry;
  - nowhere else.
- **Manifest validation at activation.** Each entry must be a forward-slash
  relative path matching `^[A-Za-z0-9_./-]+$`, with no `..` segments, no
  leading `/` or `./`, and ≤ 200 chars. A malformed manifest aborts
  activation with a clear error.
- **Path containment** is asserted on every operation that resolves a
  manifest entry under a base directory. Out-of-tree paths must throw before
  any filesystem call.
- **Destructive operations** require the workspace rules folder to end with
  `.cursor/rules/ai-rules`. Remove commands for other formats require paths
  ending with `.clinerules/ai-rules`, `.opencode/rules/ai-rules`, or
  `.claude/rules/ai-rules` respectively.
- **Recursive copies refuse symlinks.** `fs.cp` calls and the on-disk walker
  must skip symbolic links.
- **VSIX contents** are limited to compiled JS (`out/**`), the bundled rule
  pack (`bundled/**`), `icon.png` (≤ 128×128 PNG), `LICENSE`, `README.md`,
  `CHANGELOG.md`, and `package.json`. Source, scripts, lockfiles, build info,
  the high-resolution icon master, and any other tooling files must be
  excluded via `.vscodeignore`.
- **Marketplace icon** must be ≤ 128×128 PNG. The high-resolution master
  (`icon-source.png`) is preserved locally for re-rendering but excluded
  from the package.
- README is the marketplace description; it must be plain English and list
  the shipped rules, every command, and rule limitations.
- CHANGELOG follows [Keep a Changelog](https://keepachangelog.com/) with an
  `[Unreleased]` section at the top.
- Each topic rule must remain focused, imperative, and scannable.

## Out of scope

- The extension does **not** ship per-language linters, formatters, or build
  tooling — only Markdown rule files and the UI to manage them.
- The extension does **not** call any AI provider, log telemetry, or sync
  anything to the cloud.
- The extension does **not** edit user settings (`settings.json`) outside
  its own `aiRules.*` namespace.
- The extension does **not** guarantee the AI follows every active rule —
  models may drop rules under context pressure (see README → *Limitations*).
