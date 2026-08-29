# AI Rulebook rules for Claude Code

Copy this folder to `.claude/rules/ai-rules/` at the root of your project. Claude Code auto-discovers every `.md` file under `.claude/rules/`, so no config changes are needed. A `.md.disabled` file is skipped — rename it back to `.md` to turn it on.

These files are rendered from this repository's `bundled/ai-rules/` source by `scripts/build-rule-packs.mjs` and match what the AI Rulebook VS Code/Cursor extension installs automatically — grab them directly if you don't want to install the extension.
