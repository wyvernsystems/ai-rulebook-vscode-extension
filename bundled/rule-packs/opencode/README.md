# AI Rulebook rules for opencode

Copy this folder to `.opencode/rules/ai-rules/`, then add `".opencode/rules/ai-rules/*.md"` to the `instructions` array in your `opencode.json` (create the file if you don't have one). A `.md.disabled` file is skipped by that glob — rename it back to `.md` to turn it on.

These files are rendered from this repository's `bundled/ai-rules/` source by `scripts/build-rule-packs.mjs` and match what the AI Rulebook VS Code/Cursor extension installs automatically — grab them directly if you don't want to install the extension.
