# Requirements

This document captures the working requirements, constraints, and non-goals
for the **AI Rulebook** extension. Short, testable bullets only — implementation
details belong in the code or in the rule files.

## Functional

- The extension installs six always-on topic rules (`scope.mdc`, `code.mdc`,
  `tests.mdc`, `docs.mdc`, `markdown.mdc`, and `git.mdc`) into
  `.cursor/rules/ai-rules/` of the open workspace. Each rule has
  `alwaysApply: true` and is installed enabled by default.
- Before writing Cursor or Cline rules, the extension idempotently adds
  `/.cursor/rules/ai-rules/` and `/.clinerules/ai-rules/` to the workspace
  `.gitignore`, creating the file when absent.
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
  labels muted gray (via a `FileDecorationProvider`) so on / off state is
  visible without reading the description column.
- The same color scheme is applied to rule files in VS Code's built-in
  Explorer for any `<name>.mdc` / `<name>.mdc.disabled` under
  `.cursor/rules/ai-rules/` in the open workspace. Gated by
  `aiRules.colorRulesInExplorer` (default `true`).
- A pair of commands toggles the Explorer tint at the User scope without
  touching the sidebar:
  - `AI Rulebook: Hide rule colors` sets
    `aiRules.colorRulesInExplorer` to `false`.
  - `AI Rulebook: Show rule pack status` sets it back to `true`
    (idempotent), focuses the sidebar, and writes a plain-text snapshot to
    the Output channel.
- Source of truth for rule text is `.cursor/rules/ai-rules/`. The VSIX ships
  a byte-identical copy under `bundled/ai-rules/`. `npm run verify:bundled`
  must pass before packaging.
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
  `ai-rules-<topic>.md` after install, reset, manual sync, and first detection.

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
  - the open workspace, under `.cursor/rules/ai-rules/` and (with Cline)
    `.clinerules/ai-rules/`;
  - nowhere else.
- **Manifest validation at activation.** Each entry must be a forward-slash
  relative path matching `^[A-Za-z0-9_./-]+$`, with no `..` segments, no
  leading `/` or `./`, and ≤ 200 chars. A malformed manifest aborts
  activation with a clear error.
- **Path containment** is asserted on every operation that resolves a
  manifest entry under a base directory. Out-of-tree paths must throw before
  any filesystem call.
- **Destructive operations** require the workspace rules folder to end with
  `.cursor/rules/ai-rules`.
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
