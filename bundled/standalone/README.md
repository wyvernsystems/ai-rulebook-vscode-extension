# Standalone rule pack

This generated `AGENTS.md` is the file the extension writes into a fresh
workspace with a generic test command. Its source rules are in
[`bundled/ai-rules/`](../ai-rules/). Run `npm run sync-bundled` to regenerate
this directory; edit this README's template in
[`scripts/build-standalone.mjs`](../../scripts/build-standalone.mjs).

## Use in another project

1. Copy `AGENTS.md` to a project with no existing file. For an existing
   `AGENTS.md`, paste the managed block, including both the
   `<!-- ai-rulebook:start -->` and `<!-- ai-rulebook:end -->` markers.
   Preserve existing instructions and replace an older block rather than
   adding a second one.
2. In your project copy, replace "the project's test command" in the Tests
   rule with the actual command. The extension detects it automatically.
3. For Claude Code, create `CLAUDE.md` containing `@AGENTS.md`, or append
   that line to an existing `CLAUDE.md` without overwriting its content.

All six rules start enabled. Cursor, Cline, opencode, Windsurf, and supported
GitHub Copilot features can read the shared file; settings and support vary.
See the [per-tool notes](../../README.md#per-tool-notes).

## Maintain this copy

Edit source rules in `bundled/ai-rules/`, not this generated directory.
In a standalone project copy, you can edit the instructions directly.
Installing or refreshing with the extension replaces managed rule text with
its bundled version while preserving enabled/disabled section markers.
