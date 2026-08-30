#!/usr/bin/env node
/**
 * Renders `bundled/ai-rules/` (the Cursor-format source of truth) into a
 * ready-to-copy folder per supported host under `bundled/rule-packs/`:
 * `cursor/`, `cline/`, `opencode/`, `claude-code/`, `windsurf/`, and
 * `copilot/`. These folders are tracked in git and shipped as release
 * assets so someone who does not want to install the extension can still
 * grab a working rule pack for their tool of choice.
 *
 * The conversions here (frontmatter stripping, Claude `paths:` conversion,
 * Windsurf `trigger:` conversion, Copilot `applyTo:` conversion, Cline's
 * flat naming, the disabled-file convention) mirror the mirroring
 * logic in `src/rulesOperations.ts`. They are duplicated rather than
 * imported because this script runs directly with `node`, before `tsc` has
 * produced anything in `out/` — the same reason `verify-bundled.mjs` avoids
 * importing compiled output.
 *
 * Run via `npm run sync-bundled`, which calls this after regenerating the
 * manifest, so the two never drift apart. `{{TEST_COMMAND}}` is rendered as
 * generic prose ("the project's test command") since these packs are not
 * tied to any one project.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "bundled", "ai-rules");
const outRoot = path.join(repoRoot, "bundled", "rule-packs");

const TEST_COMMAND_PLACEHOLDER = "{{TEST_COMMAND}}";
const UNKNOWN_TEST_COMMAND_TEXT = "the project's test command";

function renderTestCommand(body) {
  return body.replaceAll(TEST_COMMAND_PLACEHOLDER, UNKNOWN_TEST_COMMAND_TEXT);
}

/** Same convention as the workspace mirrors: `<name>` enabled, `<name>.disabled` off. */
function writeMirror(destination, body, enabled) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (enabled) {
    fs.rmSync(`${destination}.disabled`, { force: true });
    fs.writeFileSync(destination, body, "utf8");
  } else {
    fs.rmSync(destination, { force: true });
    fs.writeFileSync(`${destination}.disabled`, body, "utf8");
  }
}

function stripCursorFrontmatter(body) {
  const firstBreak = body.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? body : body.slice(0, firstBreak);
  if (firstLine.trim() !== "---") {
    return body;
  }
  const lines = body.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return body;
}

function parseCursorFrontmatterFields(body) {
  const firstBreak = body.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? body : body.slice(0, firstBreak);
  if (firstLine.trim() !== "---") {
    return null;
  }
  const lines = body.split(/\r?\n/);
  const fields = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return fields;
    }
    const match = /^(\w+):\s*(.*)$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return null;
}

function convertCursorRuleToClaudeRule(body) {
  const fields = parseCursorFrontmatterFields(body);
  const rest = stripCursorFrontmatter(body);
  const globs = fields?.globs;
  if (!globs) {
    return rest;
  }
  return `---\npaths:\n  - ${JSON.stringify(globs)}\n---\n\n${rest}`;
}

function convertCursorRuleToWindsurfRule(body) {
  const fields = parseCursorFrontmatterFields(body);
  const rest = stripCursorFrontmatter(body);
  const globs = fields?.globs;
  const frontmatter = globs
    ? `trigger: glob\nglobs: ${JSON.stringify(globs)}`
    : "trigger: always_on";
  return `---\n${frontmatter}\n---\n\n${rest}`;
}

function convertCursorRuleToCopilotRule(body) {
  const fields = parseCursorFrontmatterFields(body);
  const rest = stripCursorFrontmatter(body);
  const applyTo = fields?.globs ?? "**";
  return `---\napplyTo: ${JSON.stringify(applyTo)}\n---\n\n${rest}`;
}

/** `foo.mdc` -> `ai-rules-foo.md`, Cline's flat mirror naming. */
function clineMirrorName(ruleFile) {
  return `ai-rules-${ruleFile.slice(0, -".mdc".length).replaceAll("/", "-")}.md`;
}

/** `foo.mdc` -> `foo.md`, shared by the opencode, Claude Code, and Windsurf packs. */
function mdcToMdName(ruleFile) {
  return `${ruleFile.replace(/\.mdc$/, "")}.md`;
}

/** `foo.mdc` -> `foo.instructions.md`, GitHub Copilot's required file suffix. */
function mdcToInstructionsMdName(ruleFile) {
  return `${ruleFile.replace(/\.mdc$/, "")}.instructions.md`;
}

if (!fs.existsSync(sourceDir)) {
  console.error("Missing rule pack source:", sourceDir);
  process.exit(1);
}

/** `code.mdc` / `code.mdc.disabled` -> `{ ruleFile: "code.mdc", enabled }`. */
function listLogicalRules(dir) {
  const byLogical = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name.endsWith(".mdc.disabled")) {
      byLogical.set(entry.name.slice(0, -".disabled".length), false);
    } else if (entry.name.endsWith(".mdc")) {
      if (!byLogical.has(entry.name)) {
        byLogical.set(entry.name, true);
      }
    }
  }
  return [...byLogical.entries()]
    .map(([ruleFile, enabled]) => ({ ruleFile, enabled }))
    .sort((a, b) => a.ruleFile.localeCompare(b.ruleFile));
}

const PACKS = [
  {
    id: "cursor",
    label: "Cursor",
    dirName: "ai-rules",
    render: (body) => body,
    fileName: (ruleFile) => ruleFile,
    usage:
      "Copy this folder to `.cursor/rules/ai-rules/` at the root of your project. " +
      "Cursor picks up `.mdc` files under `.cursor/rules/` automatically; " +
      "`.mdc.disabled` files are inert placeholders — rename one back to `.mdc` to turn it on.",
  },
  {
    id: "cline",
    label: "Cline",
    dirName: "ai-rules",
    render: (body) => body,
    fileName: clineMirrorName,
    usage:
      "Copy this folder to `.clinerules/ai-rules/` at the root of your project. " +
      "Cline loads every `.md` file under `.clinerules/`; a `.md.disabled` file is " +
      "skipped — rename it back to `.md` to turn it on.",
  },
  {
    id: "opencode",
    label: "opencode",
    dirName: "ai-rules",
    render: stripCursorFrontmatter,
    fileName: mdcToMdName,
    usage:
      'Copy this folder to `.opencode/rules/ai-rules/`, then add `".opencode/rules/ai-rules/*.md"` ' +
      "to the `instructions` array in your `opencode.json` (create the file if you don't have one). " +
      "A `.md.disabled` file is skipped by that glob — rename it back to `.md` to turn it on.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    dirName: "ai-rules",
    render: convertCursorRuleToClaudeRule,
    fileName: mdcToMdName,
    usage:
      "Copy this folder to `.claude/rules/ai-rules/` at the root of your project. " +
      "Claude Code auto-discovers every `.md` file under `.claude/rules/`, so no config " +
      "changes are needed. A `.md.disabled` file is skipped — rename it back to `.md` to turn it on.",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    dirName: "ai-rules",
    render: convertCursorRuleToWindsurfRule,
    fileName: mdcToMdName,
    usage:
      "Copy this folder to `.windsurf/rules/ai-rules/` at the root of your project. " +
      "Windsurf auto-discovers every `.md` file under `.windsurf/rules/`, so no config " +
      "changes are needed. A `.md.disabled` file is skipped — rename it back to `.md` to turn it on.",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    dirName: "ai-rules",
    render: convertCursorRuleToCopilotRule,
    fileName: mdcToInstructionsMdName,
    usage:
      "Copy this folder to `.github/instructions/ai-rules/` at the root of your project. " +
      "GitHub Copilot auto-discovers every `*.instructions.md` file under `.github/instructions/`, " +
      "so no config changes are needed. A `.instructions.md.disabled` file is skipped — rename it " +
      "back to `.instructions.md` to turn it on.",
  },
];

const rules = listLogicalRules(sourceDir);
if (rules.length === 0) {
  console.error("No .mdc rules found in", sourceDir);
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });

for (const pack of PACKS) {
  const destDir = path.join(outRoot, pack.id, pack.dirName);
  fs.mkdirSync(destDir, { recursive: true });
  for (const { ruleFile, enabled } of rules) {
    const source = path.join(sourceDir, ruleFile);
    const body = renderTestCommand(pack.render(fs.readFileSync(source, "utf8")));
    const destination = path.join(destDir, pack.fileName(ruleFile));
    writeMirror(destination, body, enabled);
  }
  fs.writeFileSync(
    path.join(outRoot, pack.id, "README.md"),
    `# AI Rulebook rules for ${pack.label}\n\n` +
      `${pack.usage}\n\n` +
      "These files are rendered from this repository's `bundled/ai-rules/` source " +
      "by `scripts/build-rule-packs.mjs` and match what the AI Rulebook VS Code/Cursor " +
      "extension installs automatically — grab them directly if you don't want to " +
      "install the extension.\n",
    "utf8"
  );
}

fs.writeFileSync(
  path.join(outRoot, "README.md"),
  "# AI Rulebook rule packs\n\n" +
    "Pre-rendered copies of the AI Rulebook rule pack, one folder per supported " +
    "tool, for anyone who wants the rules without installing the extension. Each " +
    "release also attaches these as standalone `.zip` assets — see the " +
    "[GitHub releases page](https://github.com/wyvernsystems/ai-rulebook-vscode-extension/releases).\n\n" +
    PACKS.map((p) => `- **${p.label}** — \`${p.id}/ai-rules/\``).join("\n") +
    "\n\nRegenerated by `npm run sync-bundled` from `bundled/ai-rules/`; do not edit " +
    "these files directly.\n",
  "utf8"
);

console.log(
  `Wrote ${PACKS.length} rule packs (${rules.length} rules each) to`,
  path.relative(repoRoot, outRoot)
);
