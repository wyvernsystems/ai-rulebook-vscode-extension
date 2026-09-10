# AI Rulebook

AI Rulebook is a VS Code extension that installs a small set of always-on
engineering rules for AI coding agents into your project's `AGENTS.md`. Six
topic rules cover scope, code reuse, testing, docs, Markdown, and Git. A
sidebar lets you turn each rule on and off, and every toggle edits that
rule's section of `AGENTS.md` in place.

The same file can be used by Cursor, Cline, opencode, Windsurf, and supported
GitHub Copilot features. Support depends on the tool and its settings; see
[Per-tool notes](#per-tool-notes). Claude Code reads `CLAUDE.md`, so the
extension adds a one-line `@AGENTS.md` import there.

## Get the extension

Version 4.0.0 moves the rule pack into `AGENTS.md`. Releases through 3.1.0
use the older per-tool layout; see [Upgrading from the per-tool layout](#upgrading-from-the-per-tool-layout)
before migrating an existing workspace.

Distribution channels are:

- [Open VSX](https://open-vsx.org/extension/WyvernSystemsLLC/ai-rulebook) —
  search for **AI Rulebook** in editors configured to use this registry.
- The Visual Studio Marketplace — search for **AI Rulebook** in stock VS
  Code, when the version you need has been published there.
- [GitHub releases](https://github.com/wyvernsystems/ai-rulebook-vscode-extension/releases)
  — download an attached `ai-rulebook-X.Y.Z.vsix` for manual installation
  (`code --install-extension ai-rulebook-X.Y.Z.vsix`, or Extensions panel →
  `...` → **Install from VSIX...**). Release assets vary by version; older
  releases used per-tool rule ZIPs. The current release workflow attaches a
  standalone `AGENTS.md` instead.

## Where it runs, and what it writes rules for

Two different compatibility lists matter, and they are independent:

- **Editors it runs in** — VS Code-compatible hosts supporting the
  extension API declared in `package.json` (`^1.85.0`), such as VS Code, Cursor,
  Windsurf, VSCodium, code-server / OpenVSCode Server, Eclipse Theia, and
  other forks. The sidebar and commands work the same in all of them.
- **Tools that read the rules** — anything that reads `AGENTS.md`: Cursor,
  Cline, opencode, Windsurf, supported GitHub Copilot features, and more.
  Claude Code reads the same file through the `@AGENTS.md` import in `CLAUDE.md`. The tool does
  not have to run inside the same editor: Claude Code and opencode are
  terminal tools, and `AGENTS.md` is meant to be committed so teammates get
  the rules without installing anything.

## What gets written

**Install / update rule pack** writes one managed block into `AGENTS.md`,
creating the file when the project has none and appending the block when it
already exists. Updating an existing block preserves the text before and
after it; first-time installation may add separating newlines.

```markdown
<!-- ai-rulebook:start -->
<!-- Managed by the AI Rulebook extension. ... -->

<!-- ai-rulebook:rule scope enabled -->

## Scope

- Change only what the task requires. ...

<!-- ai-rulebook:end-rule scope -->

<!-- ai-rulebook:rule git disabled -->
<!-- ai-rulebook:end-rule git -->
<!-- ai-rulebook:end -->
```

Each rule has its own section. Disabling a rule removes its text and marks
the section `disabled`; enabling it writes the text back from the bundle.
A disabled rule is removed from this block rather than commented out; copies in other files
and instructions already loaded into an agent session are unaffected.
Re-running install refreshes the wording of every section and keeps each
rule's on / off state.

Install also makes sure `CLAUDE.md` imports `AGENTS.md`, creating the file
with the line `@AGENTS.md` when it is missing and appending the line when there is no detected
import outside code fences or inline code. Existing imports in prose count.
The extension does not replace your existing `CLAUDE.md` instructions.

## Commands

The commands below are available from the command palette
(`Ctrl/Cmd+Shift+P`) under **AI Rulebook**. The sidebar toolbar provides
refresh, install, remove, legacy cleanup, status, and whole-pack toggles;
use its checkboxes or the palette for individual rules.

| Command | What it does |
| --- | --- |
| **Install / update rule pack** | Writes or refreshes the managed block in `AGENTS.md` and the `@AGENTS.md` import in `CLAUDE.md`, in every open folder. Rules you turned off stay off. |
| **Enable all rules (workspace)** | Writes every rule's text back into `AGENTS.md`. |
| **Disable all rules (workspace)** | Removes every rule's text from `AGENTS.md`, keeping the empty sections. |
| **Enable one rule…** | Picks a rule from a list and writes its section. |
| **Disable one rule…** | Picks a rule from a list and empties its section. |
| **Remove rule pack** | Deletes the managed block from `AGENTS.md` in every open folder after a confirmation. `AGENTS.md` is deleted when empty or only its default title remains; otherwise user text remains. Import cleanup runs only when `AGENTS.md` is deleted. |
| **Remove legacy per-tool rule folders…** | Deletes the folders earlier releases generated (`.cursor/rules/ai-rules/`, `.clinerules/ai-rules/`, `.opencode/rules/ai-rules/` plus its `/ai-rulebook` command, `.claude/rules/ai-rules/`, `.windsurf/rules/ai-rules/`, `.github/instructions/ai-rules/`) after a confirmation. |
| **Show rule pack status** | Focuses the sidebar and writes the on / off state to the **AI Rulebook** output channel. |
| **Refresh sidebar** | Re-reads `AGENTS.md` and repaints the sidebar and status bar. |

Install, remove, and the legacy-folder cleanup apply to every open workspace
folder. The sidebar, the status bar, and the rule toggles read and edit the
first workspace folder's `AGENTS.md`.

Selecting a rule's name in the sidebar opens `AGENTS.md` at that rule's
section via **Open rule file**, which is hidden from the command palette.

Removal decides whether to delete a file from its remaining content; it does
not record who originally created it. When `AGENTS.md` is deleted, cleanup
removes standalone `@AGENTS.md` lines outside fences from `CLAUDE.md` and
deletes that file if empty. Inline prose imports and fenced examples remain.
When `AGENTS.md` remains, its `CLAUDE.md` import remains too. Removal may
normalize blank lines around the former block.

## The rules

- **`scope.mdc`** — inspect relevant code and commands, complete and verify
  the task, resolve routine choices autonomously, keep changes in scope,
  and follow conventions without overriding safety or verification.
- **`code.mdc`** — reuse helpers and established module boundaries, check
  dependency maintenance and compatibility, validate trust-boundary input,
  protect secrets, and preserve error causes with actionable context.
- **`tests.mdc`** — test observable behavior at the appropriate level,
  reproduce bugs with regression tests when feasible, run project tests and
  existing lint/type checks, recommend a suitable linter when absent and add
  it only when requested or approved, preserve valid coverage, inspect the final diff,
  and report verification results and blockers accurately.
- **`docs.mdc`** — update documentation made inaccurate by the change,
  follow the project's layout, add user-facing release notes when appropriate,
  and create documentation only when requested or needed to explain changed
  behavior.
- **`markdown.mdc`** — one H1, no skipped heading levels, `-` bullets,
  language-tagged code fences, inline code for paths and commands, relative
  links.
- **`git.mdc`** — preserve existing work; no commits, pushes, or branches
  unless asked; stage only task changes, inspect the staged diff, and never
  rewrite pushed history unless the user names the operation.

The rules are authored as Cursor `.mdc` files in `bundled/ai-rules/`. On the
way into `AGENTS.md` the frontmatter is dropped and each rule's heading is
nested one level under the file's own title. `AGENTS.md` has no per-file
frontmatter scoping for these sections, so the Markdown rule is loaded with
the pack; its text still limits its guidance to editing Markdown files.

`tests.mdc` names your project's own test command. On install the extension
detects it from a `package.json` `test` script (using the lockfile to pick
`npm`, `pnpm`, `yarn`, or `bun`), `Cargo.toml`, `go.mod`, pytest
configuration, or a `test` target in a `Makefile`. When nothing is
conclusive the rule says "the project's test command" instead of guessing.

## Just want the rules?

You don't need the extension to use these rules.
[`bundled/standalone/AGENTS.md`](./bundled/standalone/AGENTS.md) is the file
the extension writes into a fresh workspace. The current release workflow
also attaches it to GitHub releases. Copy it to your project root, or paste
the block between
the `ai-rulebook:start` and `ai-rulebook:end` markers into an existing
`AGENTS.md`, then replace "the project's test command" in the Tests rule with
your real command. Keep both outer markers when pasting. Do not overwrite an
existing file or append a second managed block. For Claude Code, create
`CLAUDE.md` with `@AGENTS.md`, or append that line to the existing file.

## VS Code and other hosts

**Install**

Search for **AI Rulebook** in the Extensions panel, or install the VSIX from
a [GitHub release](https://github.com/wyvernsystems/ai-rulebook-vscode-extension/releases)
— see [Get the extension](#get-the-extension). To build it yourself:
`npm ci && npm test && npm run package` (see [Development](#development)
for prerequisites).

**Use**

1. Open a project folder.
2. If the project already shows signs of AI-agent use (an `AGENTS.md`,
   `CLAUDE.md`, `.cursor/`, `.clinerules/`, `.opencode/`, `.windsurf/`, or
   `.github/instructions/` entry, among others), or the host is Cursor, or
   the Cline extension is installed, the rule pack installs automatically on
   activation if its block is missing and auto-install is enabled. Otherwise
   run **AI Rulebook: Install / update rule pack**. When auto-install skips a
   project for lack of agent evidence, it shows a one-time hint.
3. Toggle rules with the **AI Rulebook** sidebar checkboxes or the
   command-palette commands. Each toggle edits `AGENTS.md`.
4. Commit `AGENTS.md` and `CLAUDE.md` so teammates and terminal tools get
   the same rules.

## Per-tool notes

- **Cursor** — supports root and nested `AGENTS.md` files; this extension
  manages only the workspace-root file. See [Cursor rules](https://cursor.com/docs/rules).
- **Cline** — recognizes `AGENTS.md` alongside its other rule sources. Check
  Cline's own Rules panel if the file is disabled there. An installed Cline
  extension is evidence for AI Rulebook's auto-install. See [Cline rules](https://docs.cline.bot/customization/cline-rules).
- **opencode** — reads `AGENTS.md` as project instructions; no extra config
  entry is needed. See [opencode rules](https://opencode.ai/docs/rules/).
- **Windsurf / Cascade** — the root `AGENTS.md` applies across the workspace;
  nested files can have narrower scope. The Windsurf documentation now
  redirects to [Devin Desktop's AGENTS.md guide](https://docs.devin.ai/desktop/cascade/agents-md).
- **GitHub Copilot** — support varies by client and feature; see
  [GitHub's support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support).
  In VS Code, `chat.useAgentsMdFile` controls loading; see
  [VS Code custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions).
  AI Rulebook does not change that setting.
- **Claude Code** — imports the shared file through `@AGENTS.md` in
  `CLAUDE.md`. See [Claude Code memory](https://code.claude.com/docs/en/memory).
  AI Rulebook leaves detected prose imports alone and ignores examples in
  code fences or inline code when checking for an import.

## Upgrading from the per-tool layout

Earlier releases mirrored the rules into a folder per tool. Those folders
are no longer written or updated. After installing this version:

1. Run **AI Rulebook: Install / update rule pack** to write `AGENTS.md`.
2. Run **AI Rulebook: Remove legacy per-tool rule folders…** to delete the
   old mirrors, and drop the `.opencode/rules/ai-rules/*.md` entry from your
   opencode config if you had one.
3. Reapply any rules you previously disabled: the new block starts with all
   bundled rules enabled and does not import state from the old folders.

## Notes

- The extension never edits `.gitignore`. `AGENTS.md` and `CLAUDE.md` are
  meant to be committed.
- Disable automatic installation with
  `aiRules.autoInstallOnOpenWorkspace: false`.
- Disable version-change prompts with `aiRules.promptInstallOnUpdate: false`.
  Both settings default to `true`. The prompt is tracked per extension
  installation, not separately for every workspace.
- Everything outside the managed block in `AGENTS.md` is yours. The
  extension preserves it when updating an existing block and refuses to
  overwrite a block whose markers are damaged. Fix the markers manually;
  the removal command also requires a valid block.
- A status bar item shows the enabled-rule count (`AI 5/6`); click it to
  show the rule pack status. It is refreshed after every command that edits
  `AGENTS.md`. Use **Refresh sidebar** after external edits; no file watcher
  keeps the UI synchronized automatically.
- If the sidebar cannot read or parse `AGENTS.md`, rules show **Unable to
  read** with details in the tooltip. Fix the file and refresh the sidebar
  to restore the checkboxes.
- The rule toggles edit sections inside the managed block, so they need the
  pack to be installed. Without it the sidebar checkboxes and the
  enable / disable commands report that the rule pack is not installed yet.

## Development

Use Node.js 24 for development, linting, and packaging. ESLint requires
Node.js 20.19+, 22.13+, or 24+. The extension still declares Node.js
`>=18.18.0`; CI tests Node 18 and 20 and runs lint on Node 24.

```bash
npm ci
npm run lint
npm test
npm run package
```

`npm test` cleans and compiles TypeScript, verifies the bundle, and runs
`node:test`, including temporary-workspace and build-script tests.
`npm run lint` checks `src/**/*.ts` with the recommended ESLint and
typescript-eslint rules and rejects warnings. `npm run test:coverage` adds
coverage reporting.
For extension-host debugging, run `npm run compile` (or `npm run watch`)
before launching **Run Extension** with F5; the launch configuration does
not build automatically.

Rule text is edited in `bundled/ai-rules/`, the tracked source of truth that
ships in the VSIX. Only `.mdc` source files are accepted; `.mdc.disabled`
files and other non-rule files are rejected. Run `npm run sync-bundled`
after adding, removing, or editing a rule file to regenerate `bundled/manifest.json` and the standalone
`bundled/standalone/AGENTS.md` and its README — commit changed generated
files alongside the rule change. Edit the standalone README template in
`scripts/build-standalone.mjs`, not the generated file.

Source rules hold the `{{TEST_COMMAND}}` token verbatim; the extension
substitutes the project's real command on the way into `AGENTS.md`. This
repo's own `AGENTS.md` carries the rendered block as a dogfooded install;
change a rule in `bundled/ai-rules/`, then re-run the install command to
regenerate it.

Requirements are tracked in [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md).
Cutting a release is documented in [docs/RELEASING.md](./docs/RELEASING.md).
The repository's installed rule pack is in [AGENTS.md](./AGENTS.md); it
contains only the rules generated by a fresh extension install.

## Limitations

- Rules are instructions, not enforcement. An AI agent can still misread or
  ignore a rule, and models tend to drop rules under context pressure in long
  sessions — re-state the rule that matters when that happens.
- Rules only load in tools that read `AGENTS.md` (or, for Claude Code,
  `CLAUDE.md`). A tool that reads neither never sees them.
- File mutations are queued per workspace within one extension host. They
  are not coordinated across editor windows or with external writers; save
  pending edits before using rule commands.
- Removing a block does not turn off auto-install. To keep it removed on
  later activation, also disable `aiRules.autoInstallOnOpenWorkspace`.
- The extension manages the rule text itself; it does not verify that code
  changes actually followed it.

## License

[MIT](./LICENSE)
