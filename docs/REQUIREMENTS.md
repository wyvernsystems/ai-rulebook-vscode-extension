# Requirements

This document captures the working requirements, constraints, and non-goals
for the **AI Rulebook** extension. Short, testable bullets only — implementation
details belong in the code or in the rule files.

## Functional

- The extension installs six topic rules (`scope.mdc`, `code.mdc`,
  `tests.mdc`, `docs.mdc`, `markdown.mdc`, and `git.mdc`) as one managed
  block inside `AGENTS.md` at the root of each open workspace folder. Every
  rule is installed enabled by default.
- The managed block is delimited by `<!-- ai-rulebook:start -->` and
  `<!-- ai-rulebook:end -->`. Inside it, each rule has its own section
  delimited by `<!-- ai-rulebook:rule <id> enabled|disabled -->` and
  `<!-- ai-rulebook:end-rule <id> -->`, in manifest order. Text outside the
  block is preserved during an update; a first install may append separating
  newlines, and removal normalizes whitespace around the removed block.
- When `AGENTS.md` does not exist, install creates it with a `# AGENTS.md`
  title followed by the block. When it exists without a block, the block is
  appended. When it already holds a block, the block is replaced in place.
- Rule text is rendered from `bundled/ai-rules/*.mdc` on the way into
  `AGENTS.md`: the Cursor frontmatter is removed, `{{TEST_COMMAND}}` is
  replaced with the detected test command (or "the project's test command"),
  and ATX headings are demoted one level (never past `######`; fenced code
  is left alone).
- Disabling a rule removes its text from `AGENTS.md` and marks its section
  `disabled`; enabling it writes the text back from the bundle with the
  current test command. Toggles edit only that rule's section. The rule's
  state is what the section marker says.
- Overlapping install, toggle, and removal operations in one extension host
  apply in invocation order per workspace, without losing changes or
  corrupting the block. A failed operation does not block later operations.
- Re-running install refreshes every section's text, keeps each rule's
  recorded state, adds sections for rules new to the bundle, and drops
  sections for rules the bundle no longer ships.
- Install also ensures `CLAUDE.md` imports `AGENTS.md`: it creates
  `CLAUDE.md` containing `@AGENTS.md` when the file is missing, appends the
  line when the file exists without an import, and leaves the file alone
  when `@AGENTS.md` already appears outside code fences and inline code.
- The extension does **not** modify the workspace `.gitignore`. `AGENTS.md`
  and `CLAUDE.md` are left unignored so they can be committed and shared.
- On activation, when `aiRules.autoInstallOnOpenWorkspace` is on (default
  `true`), the extension installs the rule pack into every open folder that
  has no block yet and shows evidence of AI-agent use: an `AGENTS.md`,
  `CLAUDE.md`, `CLAUDE.local.md`, `.claude/`, `.cursor/`, `.cursorrules`,
  `.clinerules/`, `.opencode/`, `opencode.json`, `opencode.jsonc`,
  `.windsurf/`, `.windsurfrules`, `.github/copilot-instructions.md`, or
  `.github/instructions/` entry. A Cursor host (`vscode.env.uriScheme ===
  "cursor"` or an `appName` containing `"cursor"`) or an installed Cline
  extension (`saoudrizwan.claude-dev` / `saoudrizwan.cline-nightly`) counts
  as evidence for every folder. Folders that already carry a block are
  left alone, including their disabled rules.
- When auto-install skips at least one folder for lack of evidence and
  installs into none, the extension
  shows a one-time informational hint naming the install command. The hint
  is persisted via `globalState` under `aiRules.autoInstallSkippedNoticeShown`
  so it is not repeated while that global state is retained.
- A block whose markers are damaged (a start without an end, two blocks, an
  unterminated or duplicated rule section) is never rewritten. Activation
  reports the problem when auto-install is enabled; the status bar shows a
  warning for the first folder, and install and toggle operations fail.
- The sidebar tree view lists every topic rule with a checkbox and colors
  active rule labels green and disabled rule labels red (via a
  `FileDecorationProvider`). Clicking a checkbox edits that rule's section
  in the first workspace folder's `AGENTS.md`. Selecting a rule's name opens
  `AGENTS.md` at that rule's section (`AI Rulebook: Open rule file`, hidden
  from the command palette where it would have no argument to act on).
- Command-palette actions enable or disable one selected topic rule, and
  separate actions enable or disable the complete rule pack. They act on the
  first workspace folder.
- The rule on / off commands and the sidebar checkboxes require the block to
  be installed. When it is missing they report that the rule pack is not
  installed and name the install command, instead of reporting a success
  that changed nothing.
- A status bar item shows the enabled-rule count for the first workspace
  folder (`AI 5/6`). Clicking it runs `AI Rulebook: Show rule pack status`,
  which focuses the sidebar and writes a plain-text snapshot to the Output
  channel. It is populated on activation and refreshed after every action
  that changes rule state.
- `AI Rulebook: Remove rule pack` deletes the block from `AGENTS.md` in every
  open folder after a confirmation. When the remaining text is empty or
  only `# AGENTS.md`, the file is deleted and standalone `@AGENTS.md` lines
  outside fences are removed from `CLAUDE.md` (deleting it if empty). File
  ownership is inferred from content, not recorded. Prose imports remain.
  If `AGENTS.md` remains, `CLAUDE.md` is unchanged.
- Import removal preserves `@AGENTS.md` examples inside fenced code blocks
  in `CLAUDE.md`.
- `AI Rulebook: Remove legacy per-tool rule folders…` deletes, after a
  confirmation and in every open folder, the mirrors earlier releases
  generated: `.cursor/rules/ai-rules/`, `.clinerules/ai-rules/`,
  `.opencode/rules/ai-rules/` and `.opencode/command/ai-rulebook.md`,
  `.claude/rules/ai-rules/`, `.windsurf/rules/ai-rules/`, and
  `.github/instructions/ai-rules/`. `AGENTS.md` and the opencode config are
  not touched.
- When a previous extension version is recorded in global state, the
  version changes, a folder is open, and `aiRules.promptInstallOnUpdate` is
  on (default `true`), the extension offers to re-run install. This is not
  tracked separately per workspace.
- No sidebar or palette command is hidden based on whether the host is
  Cursor or plain VS Code.
- Source of truth for rule text is `bundled/ai-rules/`, the copy shipped in
  the VSIX. `AGENTS.md` is a rendered install, not byte-identical to the
  source.
- `npm run verify:bundled` must pass before packaging. It checks that
  `bundled/manifest.json` lists exactly the rules in `bundled/ai-rules/`, that
  every rule has a `description` in its frontmatter, and that no rule carries
  a placeholder the extension cannot render.
- Bundle sync and verification reject any source file that does not end in
  `.mdc`, including the obsolete `.mdc.disabled` format. Disabled state lives
  only in the installed `AGENTS.md` block.
- `npm run sync-bundled` compiles, regenerates `bundled/manifest.json`, and
  writes `bundled/standalone/README.md` and `bundled/standalone/AGENTS.md` — the file the extension writes into
  a fresh workspace, produced by the compiled `agentsMd` module with
  `{{TEST_COMMAND}}` rendered as generic prose. It is tracked in git so
  someone can grab the rules without installing the extension, and excluded
  from the VSIX (`.vscodeignore`) since the extension only ever reads from
  `bundled/ai-rules/`.
- The bundled rules constrain task scope, code reuse and organization,
  dependency choices, input and error safety, testing integrity, triggered
  documentation updates, Markdown formatting, and unrequested Git mutations.

## Non-functional

- **License**: MIT. A `LICENSE` file ships in the VSIX.
- **Publisher**: `WyvernSystemsLLC`. Marketplace package id
  `WyvernSystemsLLC.ai-rulebook`.
- **Declared engines**: VS Code `^1.85.0`, Node `>=18.18.0`. The locked
  packaging tools require Node.js 20 or newer. CI currently tests Node 18
  and 20 on pushes to `main` and every pull request.
- **No runtime dependencies.** Only `@types/*`, `@vscode/vsce`, `ovsx`, and
  `typescript` as devDependencies.
- **No network access.** The extension must never make outbound HTTP calls.
- **No secret material.** The extension must never read or write credentials,
  tokens, environment variables, or anything outside its allowed paths.
- The extension only writes inside well-known locations in the open
  workspace folders: `AGENTS.md` (the managed block only) and `CLAUDE.md`
  (the `@AGENTS.md` line only). The legacy cleanup command deletes only the
  six per-tool folders and the opencode command file listed above. Nowhere
  else.
- **Manifest validation at activation.** Each entry must be a forward-slash
  relative path matching `^[A-Za-z0-9_./-]+$`, with no `..` segments, no
  leading `/` or `./`, and ≤ 200 chars. A malformed manifest aborts
  activation with a clear error.
- **Path containment** is asserted on every operation that resolves a
  manifest entry under the bundle directory. Out-of-tree paths must throw
  before any filesystem call, and every bundled rule is read before
  `AGENTS.md` is written.
- **Destructive operations** on legacy folders require the target path to
  end with `.cursor/rules/ai-rules`, `.clinerules/ai-rules`,
  `.opencode/rules/ai-rules`, `.opencode/command/ai-rulebook.md`,
  `.claude/rules/ai-rules`, `.windsurf/rules/ai-rules`, or
  `.github/instructions/ai-rules` respectively.
- **VSIX contents** are limited to compiled JS (`out/**`), the bundled rule
  pack (`bundled/ai-rules/**`, `bundled/manifest.json`), `icon.png`
  (≤ 128×128 PNG), `LICENSE`, `README.md`, `CHANGELOG.md`, and
  `package.json`. Repository `AGENTS.md` and `CLAUDE.md`, source, scripts,
  lockfiles, build info, legacy ZIP archives, the high-resolution icon master,
  and other tooling files are excluded via
  `.vscodeignore`.
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
  tooling — only Markdown rule text and the UI to manage it.
- The extension does **not** call any AI provider, log telemetry, or sync
  anything to the cloud.
- The extension does **not** edit user settings (`settings.json`).
- The extension does **not** write per-tool rule folders or edit tool
  config files (opencode config, Claude settings, and so on).
- No file watcher refreshes the UI after external edits. Users can run
  `Refresh sidebar`; file mutations are not locked across extension hosts
  or external processes. Removing the pack does not disable auto-install.
- The extension does **not** guarantee the AI follows every active rule —
  models may drop rules under context pressure (see README → *Limitations*).
