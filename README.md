# AI Rulebook

AI Rulebook is a VS Code extension that installs a small set of always-on
engineering rules for AI coding agents into your project. It supports Cursor,
Cline, and opencode. The six topic rules cover scope, code reuse, testing,
docs, Markdown, and Git. A sidebar lets you turn each rule on and off.

## The rules

- **`scope.mdc`** — change only what the task requires; tests and docs for
  that change are in scope; match the conventions of the file being edited.
- **`code.mdc`** — reuse existing helpers, organize by feature, choose safe
  dependencies, validate input, never log or commit secrets, wrap errors.
- **`tests.mdc`** — write failing tests for the requirement first, then the
  code; add or update unit tests for behavior changes; run the lint and type
  checks the project already has; never weaken a test to make it pass; report
  every failing or unrun check.
- **`docs.mdc`** — update `README.md`, `REQUIREMENTS.md`, `DEPLOY.md`, and
  `CHANGELOG.md` only when their trigger applies.
- **`markdown.mdc`** — one H1, no skipped heading levels, `-` bullets,
  language-tagged code fences, inline code for paths and commands, relative
  links. Scoped to `**/*.{md,mdx}`, so it only loads while editing Markdown.
- **`git.mdc`** — no commits, pushes, or branches unless asked.

`tests.mdc` names your project's own test command. On install the extension
detects it from a `package.json` `test` script (using the lockfile to pick
`npm`, `pnpm`, `yarn`, or `bun`), `Cargo.toml`, `go.mod`, pytest
configuration, or a `test` target in a `Makefile`. When nothing is
conclusive the rule says "the project's test command" instead of guessing.

## VS Code

**Install**

1. Build the extension: `npm install && npm test && npm run package`
   → produces `ai-rulebook-<version>.vsix`.
2. Extensions panel → `...` → **Install from VSIX...** (or
   `code --install-extension ai-rulebook-<version>.vsix`).

**Use**

1. Open a project folder.
2. Plain VS Code does not auto-create `.cursor/rules/ai-rules/`. Run
   **AI Rulebook: Install / update rule pack**, or set
   `aiRules.installCursorRulesFolder` to `"always"`.
3. If the project uses opencode (`AGENTS.md`, `opencode.json`, or a
   `.opencode/` folder), the rules are mirrored to opencode automatically.
4. Toggle rules with the **AI Rulebook** sidebar checkboxes or the
   command-palette commands.

## Cursor

**Install**

Install the same VSIX in Cursor — it is a VS Code-compatible host.

**Use**

1. Open a project. Six rules auto-install into `.cursor/rules/ai-rules/`,
   all enabled by default.
2. Toggle individual rules or the whole pack from the **AI Rulebook**
   sidebar.
3. Rule files in the file tree are green when enabled, red when disabled.

## opencode

**Set up the rules**

1. Install the AI Rulebook extension in VS Code or Cursor:

   ```bash
   code --install-extension ai-rulebook-2.5.1.vsix
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

If the project already has opencode files (`AGENTS.md`, `opencode.json`, or a
`.opencode/` folder), step 3 happens automatically when you open the folder —
no manual sync needed.

After setup, toggling rules in the **AI Rulebook** sidebar keeps the mirror in
sync: enabled rules stay as `<topic>.md`, disabled rules become
`<topic>.md.disabled` and are skipped.

**Without the extension**: copy the rule files into
`.opencode/rules/ai-rules/` yourself and add
`"instructions": [".opencode/rules/ai-rules/*.md"]` to your `opencode.json`.

## Notes

- Generated rule folders (`.cursor/rules/ai-rules/`,
  `.clinerules/ai-rules/`, `.opencode/rules/ai-rules/`) are added to
  `.gitignore` automatically, so each developer opts in.
- With Cline installed, the rules are mirrored to `.clinerules/ai-rules/`
  automatically.
- Disable automatic installation with
  `aiRules.autoInstallOnOpenWorkspace: false`.
- Rule files installed under `.cursor/rules/ai-rules/` are editable; the
  extension only overwrites them on install, update, or reset.

## Development

```bash
npm install
npm test
npm run package
```

Rule text is edited in `bundled/ai-rules/`, the tracked source of truth that
ships in the VSIX. Run `npm run sync-bundled` after adding or removing a rule
file to regenerate `bundled/manifest.json`.

Source rules hold the `{{TEST_COMMAND}}` token verbatim; the extension
substitutes the project's real command on the way into a workspace. The
`.cursor/rules/ai-rules/` folder in this repo is that rendered install — it is
gitignored, absent on a fresh clone, and must not be edited as if it were the
source.

Cutting a release is documented in [DEPLOY.md](./DEPLOY.md).

## License

[MIT](./LICENSE)
