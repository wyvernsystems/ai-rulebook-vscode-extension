# AI Rulebook — Cursor / VS Code extension

**One-line:** This extension installs one compact, always-on engineering rule
for Cursor and Cline.

- **Display name:** AI Rulebook
- **Package id:** `WyvernSystemsLLC.ai-rulebook`
- **License:** MIT
- **Source of truth for rules:** [`.cursor/rules/ai-rules/`](./.cursor/rules/ai-rules/)
  (the VSIX ships a byte-identical copy under [`bundled/ai-rules/`](./bundled/ai-rules/))

## What are AI rules and why use them?

A rule is a short Markdown file that tells an AI assistant how to work in a
project.

Cursor and Cline both load rules automatically when you chat with them, so the
assistant follows your team's conventions without you having to remind it
every message.

This extension ships one deliberately compressed rule covering stable
dependencies, reuse, feature organization, unit tests and coverage, core
project documents, and Markdown conventions.

```text
.cursor/rules/ai-rules/
└── core.mdc
```

## Quickstart

1. Install **AI Rulebook** in Cursor or VS Code.
2. Open the project you want the rules to apply to. The first time the
   extension sees a project, it installs `core.mdc` under
   `.cursor/rules/ai-rules/`. Existing rule folders are never overwritten.
3. Click the checklist icon in the **activity bar** (left side) to open the
   **AI Rulebook** sidebar.
4. Use the checkbox to enable or disable the core rule.
5. Start chatting.

To opt out of the first-time auto-install, set
`aiRules.autoInstallOnOpenWorkspace` to `false` and run
**`AI Rulebook: Install / update core rule`** when you want it.

## Sidebar tree view — turn the rule on or off

The **AI Rulebook** sidebar is the primary place to enable or disable the core
rule. Color makes its state obvious:

- **Green label + filled circle icon** — rule is enabled (`<name>.mdc` on
  disk, loaded by Cursor).
- **Dimmed gray label + empty circle icon** — rule is off
  (`<name>.mdc.disabled` on disk, ignored by Cursor).

The palette adapts to light, dark, and high-contrast themes through the
`aiRulebook.activeForeground` and `aiRulebook.inactiveForeground` workbench
color tokens.

What you can do from the sidebar:

| Where | Action |
|-------|--------|
| Title bar | Refresh the view. The overflow menu (`…`) holds enable, disable, install, reset, and status actions. |
| **Rule row checkbox** | Click the checkbox to flip the rule on / off (renames `<name>.mdc` ↔ `<name>.mdc.disabled`). |
| **Rule row label** | Click the rule name to open the `.mdc` file in the editor. |
| **`Show core rule status` command** | Opens / focuses the sidebar and writes its state to **Output → AI Rulebook**. |

### Same colors in the workbench Explorer

The same color scheme also applies to rule files in VS Code's built-in
**Explorer** view: `core.mdc` shows green and `core.mdc.disabled` shows muted
gray. Set `aiRules.colorRulesInExplorer` to `false` (or run **`AI Rulebook:
Hide rule colors`**) to opt out; **`AI Rulebook: Show core rule status`**
turns it back on. The sidebar tree always shows on / off colors regardless
of this setting.

## All commands

Every command lives under the **AI Rulebook:** prefix in the command palette.

### Install / update

| Command | Plain English |
|---------|---------------|
| Install / update core rule | Copies `core.mdc` into `.cursor/rules/ai-rules/`. Auto-mirrors to Cline if Cline is installed. |
| Reset core rule to default… | Replaces the workspace rules folder with `core.mdc`, removing extra files. |
| Sync core rule to Cline | Mirrors `core.mdc` into `.clinerules/ai-rules/`. |

### Turn the rule on or off

| Command | Plain English |
|---------|---------------|
| Enable core rule (workspace) | Enables `core.mdc`. |
| Disable core rule (workspace) | Renames `core.mdc` to `core.mdc.disabled`. |

### Inspect / refresh

| Command | Plain English |
|---------|---------------|
| Show core rule status | Turns Explorer coloring on, focuses the sidebar, and writes the state to **Output → AI Rulebook**. |
| Hide rule colors | Turns Explorer rule coloring off. The sidebar colors are unaffected. |
| Refresh sidebar | Re-reads the rules folder from disk and redraws the sidebar tree. |
| Open rule file | Opens a specific `.mdc` in the editor (used by the sidebar tree). |

## Settings

| Setting | Default | Effect |
|---------|---------|--------|
| `aiRules.autoInstallOnOpenWorkspace` | `true` | When you open a workspace that has no `.cursor/rules/ai-rules/` folder yet, install the bundled core rule automatically. Never overwrites an existing folder. |
| `aiRules.installCursorRulesFolder` | `"auto"` | Policy for the `.cursor/rules/ai-rules/` auto-install. `"auto"` only creates it when the host is Cursor, `"always"` creates it in any host (e.g. you're committing the folder for Cursor-using teammates while editing in plain VS Code), `"never"` skips it entirely. Manual install / reset commands ignore this. |
| `aiRules.colorRulesInExplorer` | `true` | Tint rule files in VS Code's Explorer: `.mdc` (active) appears green and `.mdc.disabled` (off) appears muted gray, anywhere under `.cursor/rules/ai-rules/`. |
| `aiRules.promptInstallOnUpdate` | `true` | When the extension version changes, ask whether to refresh workspace rules from the bundled copy. |
| `aiRules.autoSyncClineWhenInstalled` | `true` | If Cline is installed, mirror `core.mdc` into `.clinerules/ai-rules/` whenever it changes. Independent of `installCursorRulesFolder` — Cline users on plain VS Code still get the Cline mirror without the `.cursor/` folder. |

## Shipped rule

`core.mdc` is always applied while enabled. Its source lives under
`.cursor/rules/ai-rules/`; the VSIX copy lives under `bundled/ai-rules/`.

## Limitations — read this before you blame the rules

Rules are **instructions to the model**, not enforcement. The assistant
chooses how to weigh them on every reply. In practice this means:

- **Context is limited.** Rules, files, and chat history share the model's
  context window. The bundled rule is compressed to minimize that cost.
- **Models drift between turns.** A rule may apply on the first reply and not
  on the third. Re-mention `@core` or restate the relevant expectation.
- **Different products read rules differently.** Cursor and Cline don't have
  identical engines; Cline mirrors are best-effort.

**Practical advice:**

- If you want a rule to fire **definitely**, `@-mention` it in your message.
- If a rule keeps getting ignored, shorten it. Compressed rules survive
  truncation better.

## Security model

This extension only writes inside two well-known locations:

- the open workspace folder, under `.cursor/rules/ai-rules/` and (if Cline is
  installed) `.clinerules/ai-rules/`;
- nothing outside those paths.

Defenses applied:

- **Manifest validation at activation.** Each entry in `bundled/manifest.json`
  must be a forward-slash relative path matching `^[A-Za-z0-9_./-]+$`, with
  no `..` segments, no leading `/` or `./`, and ≤ 200 chars. A tampered or
  malformed manifest aborts activation with a clear error.
- **Path containment.** Every operation that resolves a manifest entry under
  a base directory re-checks that the resolved path stays inside that base.
  Out-of-tree paths throw before any filesystem call.
- **Destructive operations are gated by an explicit suffix check.** The
  workspace rules folder must end with `.cursor/rules/ai-rules`; a
  misconfigured constant cannot widen the blast radius of `rm -rf`.
- **No symlinks during recursive copies.** The `fs.cp` calls used to mirror
  the bundle filter out symbolic links; the directory walker skips them too.
- **No network access.** The extension never makes outbound HTTP calls.
- **No runtime dependencies.** `package.json` has zero `dependencies`. The
  VSIX ships only compiled JS, the bundled rule files, an icon, the readme,
  changelog, and license.
- **No secret material.** The extension never reads or writes credentials,
  environment variables, or anything outside the rule files listed above.

If you find a security issue, please open a private report on the issues
tracker (linked in `package.json → bugs`).

## Develop

```bash
npm install
npm run sync-bundled    # copy .cursor/rules/ai-rules → bundled/ai-rules
npm run verify:bundled  # fail if bundled ≠ source (run after sync)
npm run compile         # tsc → out/
```

Press **F5** with this repo open in VS Code (or Cursor) to launch the
**Extension Development Host** with the dev build.

The **source of truth** for rule text is `.cursor/rules/ai-rules/`. The VSIX
ships `bundled/ai-rules/`; the `vscode:prepublish` script runs
**sync → verify → compile** to keep them identical.

## Package the VSIX (for the marketplace)

```bash
npm install
npm run sync-bundled
npm run verify:bundled
npm run compile
npx --no-install vsce package
```

This produces `ai-rulebook-<version>.vsix` in the repo root. To upload it
to the [VS Code Marketplace](https://marketplace.visualstudio.com/manage):

1. Sign in as the publisher (`WyvernSystemsLLC`).
2. Choose **New extension → Visual Studio Code**.
3. Upload the `.vsix`.

For the [Open VSX](https://open-vsx.org/) registry (used by Cursor's gallery),
follow [their publishing guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

## Notes

- Cline may interpret YAML differently from Cursor; treat
  Cline output as best-effort.
