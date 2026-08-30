# AI Rulebook

AI Rulebook is a VS Code extension that installs a small set of always-on
engineering rules for AI coding agents into your project. It supports Cursor,
Cline, opencode, Claude Code, Windsurf, and GitHub Copilot. The six topic
rules cover scope, code reuse, testing, docs, Markdown, and Git. A sidebar
lets you turn each rule on and off.

## Get the extension

The extension is distributed in three places, all carrying the same build:

- [Open VSX](https://open-vsx.org/extension/WyvernSystemsLLC/ai-rulebook) —
  the registry used by Cursor, Windsurf, VSCodium, code-server /
  OpenVSCode Server, Eclipse Theia, and most other VS Code forks. In those
  editors, search for **AI Rulebook** in the Extensions panel.
- The Visual Studio Marketplace — the registry stock VS Code searches from
  its Extensions panel.
- [GitHub releases](https://github.com/wyvernsystems/ai-rulebook-vscode-extension/releases)
  — every release attaches the `ai-rulebook-X.Y.Z.vsix` for manual installs
  (`code --install-extension ai-rulebook-X.Y.Z.vsix`, or Extensions panel →
  `...` → **Install from VSIX...**), plus standalone per-tool rule-pack zips
  for using the rules without the extension.

## Where it runs, and what it writes rules for

Two different compatibility lists matter, and they are independent:

- **Editors it runs in** — any VS Code-compatible host: VS Code, Cursor,
  Windsurf, VSCodium, code-server / OpenVSCode Server, Eclipse Theia, and
  other forks. The sidebar, commands, and automatic sync work the same in
  all of them.
- **Tools it writes rules for** — Cursor, Cline, opencode, Claude Code,
  Windsurf, and GitHub Copilot, each in its native format and location (see
  the per-tool sections below). The tool does not have to run inside the
  same editor: Claude Code and opencode are terminal tools, and the
  generated rule folders can be committed so teammates get them without
  installing anything.

## Commands

Every command is available from the command palette (`Ctrl/Cmd+Shift+P`) under
the **AI Rulebook** category. The sync and remove commands also appear in the
**AI Rulebook** sidebar's toolbar menu, under **Sync rule packs** and
**Remove rule packs**.

| Command | What it does |
| --- | --- |
| **Install / update rule pack** | Writes the bundled rules into `.cursor/rules/ai-rules/`, then mirrors to Cline, opencode, Claude Code, Windsurf, and GitHub Copilot wherever they apply. Every rule is (re-)enabled. |
| **Reset rule pack to defaults…** | Replaces the whole `.cursor/rules/ai-rules/` folder with the bundled copy after a confirmation, deleting extra files you added there. |
| **Enable all rules (workspace)** | Turns every rule on and updates each mirror. |
| **Disable all rules (workspace)** | Turns every rule off and updates each mirror. |
| **Enable one rule…** | Picks a rule from a list and turns it on, updating each mirror. |
| **Disable one rule…** | Picks a rule from a list and turns it off, updating each mirror. |
| **Sync rule pack to Cursor** | Refreshes `.cursor/rules/ai-rules/` from the bundle, keeping each rule's on / off state. |
| **Sync rule pack to Cline** | Writes `.clinerules/ai-rules/` in every open folder, whether or not Cline is installed. |
| **Sync rule pack to opencode** | Writes `.opencode/rules/ai-rules/`, registers the glob in the opencode config, and adds the `/ai-rulebook` command — in every open folder. |
| **Sync rule pack to Claude Code** | Writes `.claude/rules/ai-rules/` in every open folder. |
| **Sync rule pack to Windsurf** | Writes `.windsurf/rules/ai-rules/` in every open folder. |
| **Sync rule pack to GitHub Copilot** | Writes `.github/instructions/ai-rules/` in every open folder. |
| **Sync rule pack to all formats** | Runs all six syncs in one step, keeping each rule's on / off state. |
| **Remove Cursor rule pack** | Deletes `.cursor/rules/ai-rules/` after a confirmation. |
| **Remove Cline rule pack** | Deletes `.clinerules/ai-rules/` after a confirmation. |
| **Remove opencode rule pack** | Deletes `.opencode/rules/ai-rules/` and the `/ai-rulebook` command after a confirmation. The config `instructions` entry is left alone. |
| **Remove Claude Code rule pack** | Deletes `.claude/rules/ai-rules/` after a confirmation. |
| **Remove Windsurf rule pack** | Deletes `.windsurf/rules/ai-rules/` after a confirmation. |
| **Remove GitHub Copilot rule pack** | Deletes `.github/instructions/ai-rules/` after a confirmation. |
| **Remove all rule packs** | Deletes all six rule folders after a confirmation. |
| **Show rule pack status** | Turns Explorer rule colors back on, focuses the sidebar, and writes the on / off state to the **AI Rulebook** output channel. |
| **Hide rule colors** | Turns off the green / red tint on rule files in the Explorer. The sidebar keeps its colors. |
| **Refresh sidebar** | Re-reads rule state from disk and repaints the sidebar and status bar. |

The remove commands and the Cline / opencode / Claude Code / Windsurf /
GitHub Copilot syncs apply to every open workspace folder. Anything touching
`.cursor/rules/ai-rules/` — install, reset, sync to Cursor, and the rule
toggles — applies to the first workspace folder only.

**Sync vs. install**: the *Sync* commands push what the sidebar currently
shows, so a rule you turned off stays off in every format. *Install / update*
and *Reset to defaults* deliberately start from the bundled defaults, which
turns every rule back on.

## The rules

- **`scope.mdc`** — change only what the task requires; tests and docs for
  that change are in scope; match the conventions of the file being edited;
  report unrelated bugs instead of fixing them.
- **`code.mdc`** — reuse existing helpers, organize by feature, prefer the
  standard library over new dependencies and choose safe ones, validate
  input at trust boundaries, never log or commit secrets, wrap errors.
- **`tests.mdc`** — for behavior changes, write failing tests for the
  requirement first, then the code; run the lint and type checks the project
  already has; never weaken a test to make it pass; report every failing or
  unrun check.
- **`docs.mdc`** — update `README.md`, `CHANGELOG.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, Spec Kit feature specs (`specs/<NNN-feature>/spec.md`),
  `docs/ARCHITECTURE.md`, `docs/RELEASING.md`, `docs/DEPLOY.md`, and
  `docs/decisions/` only when the file exists and its trigger applies. New
  docs are created by graduating an outgrown `README.md` section into
  `docs/`, never speculatively. Defaults to platform-read files at the repo
  root with everything else in `docs/`, unless the project already has its
  own convention.
- **`markdown.mdc`** — one H1, no skipped heading levels, `-` bullets,
  language-tagged code fences, inline code for paths and commands, relative
  links. Scoped to `**/*.{md,mdx}`, so it only loads while editing Markdown.
- **`git.mdc`** — no commits, pushes, or branches unless asked; when asked,
  stage only the task's files and write an imperative subject; never rewrite
  pushed history unless the user names the operation.

`tests.mdc` names your project's own test command. On install the extension
detects it from a `package.json` `test` script (using the lockfile to pick
`npm`, `pnpm`, `yarn`, or `bun`), `Cargo.toml`, `go.mod`, pytest
configuration, or a `test` target in a `Makefile`. When nothing is
conclusive the rule says "the project's test command" instead of guessing.

## Just want the rules?

You don't need the extension to use these rules. [`bundled/rule-packs/`](./bundled/rule-packs)
in this repo has a ready-to-copy folder per tool — `cursor/`, `cline/`,
`opencode/`, `claude-code/`, `windsurf/`, `copilot/` — already rendered in
that tool's format. Every
[GitHub release](https://github.com/wyvernsystems/ai-rulebook-vscode-extension/releases)
also attaches them as standalone `ai-rulebook-rules-<tool>-X.Y.Z.zip` files,
so you can grab just the one you need without cloning the repo. Drop the
`ai-rules/` folder it contains into the location named in that tool's section
below.

## VS Code

**Install**

Search for **AI Rulebook** in the Extensions panel, or install the VSIX from
a [GitHub release](https://github.com/wyvernsystems/ai-rulebook-vscode-extension/releases)
— see [Get the extension](#get-the-extension). To build it yourself:
`npm install && npm test && npm run package`.

**Use**

1. Open a project folder.
2. Plain VS Code does not auto-create `.cursor/rules/ai-rules/`. Run
   **AI Rulebook: Install / update rule pack**, or set
   `aiRules.installCursorRulesFolder` to `"always"`.
3. If the project uses opencode (`AGENTS.md`, `opencode.json`, or a
   `.opencode/` folder), the rules are mirrored to opencode automatically.
4. If the project uses Claude Code (`CLAUDE.md`, `CLAUDE.local.md`, or a
   `.claude/` folder), the rules are mirrored to Claude Code automatically.
5. If the project uses Windsurf (a `.windsurf/` folder or a `.windsurfrules`
   file), the rules are mirrored to Windsurf automatically.
6. If the project uses GitHub Copilot custom instructions (a
   `.github/copilot-instructions.md` file or a `.github/instructions/`
   folder), the rules are mirrored to Copilot automatically.
7. Toggle rules with the **AI Rulebook** sidebar checkboxes or the
   command-palette commands.

## Cursor

**Install**

Search for **AI Rulebook** in Cursor's Extensions panel (Cursor installs
extensions from Open VSX), or install the same VSIX — Cursor is a
VS Code-compatible host.

**Use**

1. Open a project. Six rules auto-install into `.cursor/rules/ai-rules/`,
   all enabled by default.
2. Toggle individual rules or the whole pack from the **AI Rulebook**
   sidebar.
3. Rule files in the file tree are green when enabled, red when disabled.

**Without the extension**: grab [`bundled/rule-packs/cursor/`](./bundled/rule-packs/cursor)
(or its release zip) and copy its `ai-rules/` folder to
`.cursor/rules/ai-rules/`.

## opencode

**Set up the rules**

1. Install the AI Rulebook extension in VS Code or Cursor:

   ```bash
   code --install-extension ai-rulebook-3.1.0.vsix
   ```

   or Extensions panel → `...` → **Install from VSIX...**.
2. Open your project folder in that editor.
3. Open the command palette and run
   **AI Rulebook: Sync rule pack to opencode**. This writes the six rules to
   `.opencode/rules/ai-rules/` and adds
   `"instructions": [".opencode/rules/ai-rules/*.md"]` to your opencode
   config (it creates `opencode.json` if you don't have one).
4. Verify: `.opencode/rules/ai-rules/` now contains `code.md`, `docs.md`,
   `git.md`, `markdown.md`, `scope.md`, and `tests.md`, and your opencode
   config lists that folder in `instructions`.
5. Restart opencode and open the project — the rules load alongside
   `AGENTS.md`.

Step 3 also writes `.opencode/command/ai-rulebook.md`, a `/ai-rulebook`
command that lists the active and disabled rules from inside opencode.

If the project already has opencode files (`AGENTS.md`, `opencode.json`, or a
`.opencode/` folder), step 3 happens automatically when you open the folder —
no manual sync needed.

After setup, toggling rules in the **AI Rulebook** sidebar keeps the mirror in
sync: enabled rules stay as `<topic>.md`, disabled rules become
`<topic>.md.disabled` and are skipped.

**Without the extension**: grab [`bundled/rule-packs/opencode/`](./bundled/rule-packs/opencode)
(or its release zip) and copy its `ai-rules/` folder to
`.opencode/rules/ai-rules/`, then add
`"instructions": [".opencode/rules/ai-rules/*.md"]` to your `opencode.json`.

## Claude Code

**Set up the rules**

1. Install the AI Rulebook extension in VS Code or Cursor:

   ```bash
   code --install-extension ai-rulebook-3.1.0.vsix
   ```

   or Extensions panel → `...` → **Install from VSIX...**.
2. Open your project folder in that editor.
3. Open the command palette and run
   **AI Rulebook: Sync rule pack to Claude Code**. This writes the six rules
   to `.claude/rules/ai-rules/` as `code.md`, `docs.md`, `git.md`,
   `markdown.md`, `scope.md`, and `tests.md`. Claude Code auto-discovers every
   `.md` file under `.claude/rules/`, so no config file needs editing.
4. Open the project with Claude Code — the rules load automatically. The
   `markdown.mdc` rule's Cursor `globs` scoping carries over as Claude's
   `paths:` frontmatter, so it only loads while Claude is working with
   Markdown files; the rest load every session.

If the project already has Claude Code files (`CLAUDE.md`, `CLAUDE.local.md`,
or a `.claude/` folder), step 3 happens automatically when you open the
folder — no manual sync needed.

After setup, toggling rules in the **AI Rulebook** sidebar keeps the mirror in
sync: enabled rules stay as `<topic>.md`, disabled rules become
`<topic>.md.disabled` and are skipped.

**Without the extension**: grab [`bundled/rule-packs/claude-code/`](./bundled/rule-packs/claude-code)
(or its release zip) and copy its `ai-rules/` folder to
`.claude/rules/ai-rules/` — no config file changes needed.

## Windsurf

**Set up the rules**

1. Install the AI Rulebook extension in VS Code or Cursor:

   ```bash
   code --install-extension ai-rulebook-3.1.0.vsix
   ```

   or Extensions panel → `...` → **Install from VSIX...**.
2. Open your project folder in that editor.
3. Open the command palette and run
   **AI Rulebook: Sync rule pack to Windsurf**. This writes the six rules to
   `.windsurf/rules/ai-rules/` as `code.md`, `docs.md`, `git.md`,
   `markdown.md`, `scope.md`, and `tests.md`, each with a `trigger:`
   frontmatter field. Windsurf auto-discovers every `.md` file under
   `.windsurf/rules/`, so no config file needs editing.
4. Open the project in Windsurf — the rules load automatically. The
   `markdown.mdc` rule's Cursor `globs` scoping carries over as
   `trigger: glob` with a matching `globs:` field, so it only loads while
   editing Markdown files; the rest use `trigger: always_on`.

If the project already shows evidence of Windsurf usage (a `.windsurf/`
folder or a `.windsurfrules` file), step 3 happens automatically when you
open the folder — no manual sync needed.

After setup, toggling rules in the **AI Rulebook** sidebar keeps the mirror in
sync: enabled rules stay as `<topic>.md`, disabled rules become
`<topic>.md.disabled` and are skipped.

**Without the extension**: grab [`bundled/rule-packs/windsurf/`](./bundled/rule-packs/windsurf)
(or its release zip) and copy its `ai-rules/` folder to
`.windsurf/rules/ai-rules/` — no config file changes needed.

## GitHub Copilot

**Set up the rules**

1. Install the AI Rulebook extension in VS Code or Cursor:

   ```bash
   code --install-extension ai-rulebook-3.1.0.vsix
   ```

   or Extensions panel → `...` → **Install from VSIX...**.
2. Open your project folder in that editor.
3. Open the command palette and run
   **AI Rulebook: Sync rule pack to GitHub Copilot**. This writes the six
   rules to `.github/instructions/ai-rules/` as `code.instructions.md`,
   `docs.instructions.md`, `git.instructions.md`, `markdown.instructions.md`,
   `scope.instructions.md`, and `tests.instructions.md`, each with a required
   `applyTo:` frontmatter field. Copilot auto-discovers every
   `*.instructions.md` file under `.github/instructions/`, so no config file
   needs editing.
4. Open the project with GitHub Copilot — the rules load automatically. The
   `markdown.mdc` rule's Cursor `globs` scoping carries over as Copilot's
   `applyTo:` glob, so it only applies while editing Markdown files; the rest
   use `applyTo: "**"`.

If the project already shows evidence of Copilot custom-instructions usage (a
`.github/copilot-instructions.md` file or a `.github/instructions/` folder),
step 3 happens automatically when you open the folder — no manual sync
needed.

After setup, toggling rules in the **AI Rulebook** sidebar keeps the mirror in
sync: enabled rules stay as `<topic>.instructions.md`, disabled rules become
`<topic>.instructions.md.disabled` and are skipped.

**Without the extension**: grab [`bundled/rule-packs/copilot/`](./bundled/rule-packs/copilot)
(or its release zip) and copy its `ai-rules/` folder to
`.github/instructions/ai-rules/` — no config file changes needed.

## Notes

- Generated rule folders (`.cursor/rules/ai-rules/`,
  `.clinerules/ai-rules/`, `.opencode/rules/ai-rules/`,
  `.claude/rules/ai-rules/`, `.windsurf/rules/ai-rules/`,
  `.github/instructions/ai-rules/`) are left unignored so they can be
  committed and shared with the team.
- With Cline installed, the rules are mirrored to `.clinerules/ai-rules/`
  automatically. Toggling rules in the **AI Rulebook** sidebar keeps that
  mirror in sync too: enabled rules stay as `ai-rules-<topic>.md`, disabled
  rules become `ai-rules-<topic>.md.disabled` and are skipped. Without the
  extension, grab [`bundled/rule-packs/cline/`](./bundled/rule-packs/cline)
  (or its release zip) and copy its `ai-rules/` folder to
  `.clinerules/ai-rules/`.
- Disable automatic installation with
  `aiRules.autoInstallOnOpenWorkspace: false`.
- Rule files installed under `.cursor/rules/ai-rules/` are editable; the
  extension only overwrites them on install, update, or reset.
- A status bar item shows the enabled-rule count (`AI 5/6`) and the opencode
  config sync state; click it to run **Sync rule pack to opencode**. It is
  refreshed after every command that writes or deletes rule files.
- In a multi-root workspace, Cline/opencode/Claude Code/Windsurf/Copilot
  mirroring and their manual sync commands run in every open folder that
  shows evidence for that tool, and the remove commands clear every open
  folder. The `.cursor/rules/ai-rules/` install itself — and the sidebar
  rule toggles — apply to the first workspace folder only.
- Rule toggles rename files inside `.cursor/rules/ai-rules/`, so they need
  that folder to exist. Without it the sidebar checkboxes and the
  enable / disable commands report that the rule pack is not installed yet.

## Development

```bash
npm install
npm test
npm run package
```

Rule text is edited in `bundled/ai-rules/`, the tracked source of truth that
ships in the VSIX. Run `npm run sync-bundled` after adding, removing, or
editing a rule file to regenerate `bundled/manifest.json` and the per-tool
folders under `bundled/rule-packs/` — commit both alongside the rule change.

Source rules hold the `{{TEST_COMMAND}}` token verbatim; the extension
substitutes the project's real command on the way into a workspace. Any
`.cursor/rules/ai-rules/` folder (or Cline / opencode / Claude Code /
Windsurf / Copilot mirror) that appears in this repo is such a rendered
install — it is not tracked in git and is not byte-identical to the source,
so never edit it as if it were the source. Change a rule in
`bundled/ai-rules/`, then re-run the install or a sync command to regenerate
it.

Requirements are tracked in [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md).
Cutting a release is documented in [docs/RELEASING.md](./docs/RELEASING.md).
Agent-facing build and workflow facts are in [AGENTS.md](./AGENTS.md).

## Limitations

- Rules are instructions, not enforcement. An AI agent can still misread or
  ignore a rule, and models tend to drop rules under context pressure in long
  sessions — re-state the rule that matters when that happens.
- Rules only load in tools that read the installed folder. A tool this
  extension doesn't mirror to never sees them.
- The extension manages the rule files themselves; it does not verify that
  code changes actually followed them.

## License

[MIT](./LICENSE)
