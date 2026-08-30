# AGENTS.md

AI Rulebook is a VS Code extension that installs a rule pack for AI coding
agents into projects, mirrored to Cursor, Cline, opencode, and Claude Code
formats. TypeScript sources are in `src/`, tests in `tests/*.test.mjs`
(`node:test`), build scripts in `scripts/`.

## Commands

```bash
npm install
npm test              # compile + verify bundled packs + unit tests
npm run sync-bundled  # regenerate manifest and rule packs after editing a rule
npm run package       # build the VSIX
```

## Rule-editing workflow

- `bundled/ai-rules/*.mdc` is the only editable source of truth for rule
  text. After changing it, run `npm run sync-bundled` and commit
  `bundled/manifest.json` and `bundled/rule-packs/` alongside.
- The workspace folders `.cursor/rules/ai-rules/`, `.claude/rules/ai-rules/`,
  `.clinerules/ai-rules/`, and `.opencode/rules/ai-rules/` are generated
  installs. They are committed, but never edit them as if they were the
  source — regenerate them from the bundle instead.
- Keep the `{{TEST_COMMAND}}` token verbatim in source rules; the extension
  substitutes the real command at install time.

## Conventions

- This repo runs on its own rule pack: see `.claude/rules/ai-rules/` (or the
  mirrors) for the scope, tests-first, docs, Markdown, and Git rules that
  apply to every change here.
- Requirements live in [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md);
  releases are cut per [docs/DEPLOY.md](./docs/DEPLOY.md).
