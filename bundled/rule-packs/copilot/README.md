# AI Rulebook rules for GitHub Copilot

Copy this folder to `.github/instructions/ai-rules/` at the root of your project. GitHub Copilot auto-discovers every `*.instructions.md` file under `.github/instructions/`, so no config changes are needed. A `.instructions.md.disabled` file is skipped — rename it back to `.instructions.md` to turn it on.

These files are rendered from this repository's `bundled/ai-rules/` source by `scripts/build-rule-packs.mjs` and match what the AI Rulebook VS Code/Cursor extension installs automatically — grab them directly if you don't want to install the extension.
