# AI Rulebook

AI Rulebook installs a focused set of always-on engineering rules for Cursor,
with optional Cline support.

The rules ask AI agents to:

- keep changes within the requested scope;
- reuse code, organize by feature, and handle inputs and errors safely;
- add unit tests and report every failing or unrun check;
- update project documentation only when its trigger applies;
- use consistent Markdown and avoid unrequested Git mutations.

## Use

1. Install **AI Rulebook**.
2. Open a project in Cursor.
3. The extension installs six topic rules under `.cursor/rules/ai-rules/`.
   Every rule is enabled and marked `alwaysApply: true` by default.
4. Use the **AI Rulebook** sidebar checkboxes or commands to change their
   enabled state.

The generated Cursor and Cline rule folders are automatically added to the
project's `.gitignore`, so using the extension remains optional for each
developer.

To disable automatic installation, set
`aiRules.autoInstallOnOpenWorkspace` to `false`.

## Commands

Open the command palette and search for **AI Rulebook**. Rule-state commands
include:

- **Enable one rule…** and **Disable one rule…** select an individual topic.
- **Enable all rules (workspace)** and **Disable all rules (workspace)** change
  the complete pack together.

Additional commands install, update, or reset the pack; open rules or show pack
status; sync to Cline; and show or hide rule colors.

## Rule files

The editable source contains one file per topic:

```text
.cursor/rules/ai-rules/
├── code.mdc
├── docs.mdc
├── git.mdc
├── markdown.mdc
├── scope.mdc
└── tests.mdc
```

The extension packages synchronized copies under `bundled/ai-rules/`.

## Development

```bash
npm install
npm test
npm run package
```

Run `npm run sync-bundled` after editing the source rule files.

## License

[MIT](./LICENSE)
