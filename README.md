# AI Rulebook

AI Rulebook installs one compact, always-on engineering rule for Cursor, with
optional Cline support.

The rule asks AI agents to:

- prefer stable LTS tools and libraries;
- reuse code and organize by feature;
- add unit tests and report coverage;
- maintain `README.md`, `REQUIREMENTS.md`, and `CHANGELOG.md`;
- use consistent Markdown.

## Use

1. Install **AI Rulebook**.
2. Open a project in Cursor.
3. The extension installs `.cursor/rules/ai-rules/core.mdc`.
4. Use the **AI Rulebook** sidebar checkbox to enable or disable it.

The generated Cursor and Cline rule folders are automatically added to the
project's `.gitignore`, so using the extension remains optional for each
developer.

To disable automatic installation, set
`aiRules.autoInstallOnOpenWorkspace` to `false`.

## Commands

Open the command palette and search for **AI Rulebook** to:

- install, update, enable, disable, or reset the core rule;
- open the rule or show its status;
- sync the rule to Cline;
- show or hide rule colors.

## Rule files

The editable source is:

```text
.cursor/rules/ai-rules/core.mdc
```

The extension packages a synchronized copy at
`bundled/ai-rules/core.mdc`.

## Development

```bash
npm install
npm test
npm run package
```

Run `npm run sync-bundled` after editing `core.mdc`.

## License

[MIT](./LICENSE)
