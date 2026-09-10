#!/usr/bin/env node
/**
 * Renders `bundled/ai-rules/` into a ready-to-copy `bundled/standalone/AGENTS.md`
 * (plus a short README) for people who want the rule pack without installing
 * the extension. The file is exactly what the extension writes into a fresh
 * workspace, produced by the same compiled code (`out/agentsMd.js`), so the
 * two can never drift. `{{TEST_COMMAND}}` is rendered as generic prose
 * because a standalone file is not tied to any one project.
 *
 * Run via `npm run sync-bundled`, which compiles first.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bundleDir = path.join(repoRoot, "bundled", "ai-rules");
const outDir = path.join(repoRoot, "bundled", "standalone");

const { installRulesIntoAgentsMd, agentsMdPath } = await import(
  path.join(repoRoot, "out", "agentsMd.js")
);
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "bundled", "manifest.json"), "utf8"));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ai-rulebook-standalone-"));
try {
  await installRulesIntoAgentsMd(scratch, bundleDir, manifest.files, null);
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(agentsMdPath(scratch), path.join(outDir, "AGENTS.md"));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

fs.writeFileSync(
  path.join(outDir, "README.md"),
  `# Standalone rule pack

This generated \`AGENTS.md\` is the file the extension writes into a fresh
workspace with a generic test command. Its source rules are in
[\`bundled/ai-rules/\`](../ai-rules/). Run \`npm run sync-bundled\` to regenerate
this directory; edit this README's template in
[\`scripts/build-standalone.mjs\`](../../scripts/build-standalone.mjs).

## Use in another project

1. Copy \`AGENTS.md\` to a project with no existing file. For an existing
   \`AGENTS.md\`, paste the managed block, including both the
   \`<!-- ai-rulebook:start -->\` and \`<!-- ai-rulebook:end -->\` markers.
   Preserve existing instructions and replace an older block rather than
   adding a second one.
2. In your project copy, replace "the project's test command" in the Tests
   rule with the actual command. The extension detects it automatically.
3. For Claude Code, create \`CLAUDE.md\` containing \`@AGENTS.md\`, or append
   that line to an existing \`CLAUDE.md\` without overwriting its content.

All six rules start enabled. Cursor, Cline, opencode, Windsurf, and supported
GitHub Copilot features can read the shared file; settings and support vary.
See the [per-tool notes](../../README.md#per-tool-notes).

## Maintain this copy

Edit source rules in \`bundled/ai-rules/\`, not this generated directory.
In a standalone project copy, you can edit the instructions directly.
Installing or refreshing with the extension replaces managed rule text with
its bundled version while preserving enabled/disabled section markers.
`
);
console.log("Wrote bundled/standalone/AGENTS.md with", manifest.files.length, "rules.");
