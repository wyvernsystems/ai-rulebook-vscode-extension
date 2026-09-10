#!/usr/bin/env node
/**
 * Checks that the rule pack shipped in the VSIX is internally consistent:
 * `bundled/manifest.json` lists exactly the rules present in
 * `bundled/ai-rules/`, every rule has usable frontmatter, and no rule carries
 * a placeholder the extension cannot render.
 *
 * Workspace `AGENTS.md` is a rendered install and is not compared with the
 * source. This script runs independently of compiled extension code.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Kept in sync with TEST_COMMAND_PLACEHOLDER in `src/testCommand.ts`. */
const KNOWN_PLACEHOLDERS = new Set(["{{TEST_COMMAND}}"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bundleDir = path.join(repoRoot, "bundled", "ai-rules");
const manifestPath = path.join(repoRoot, "bundled", "manifest.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(bundleDir)) {
  fail(`Missing rule pack source: ${bundleDir}`);
}
if (!fs.existsSync(manifestPath)) {
  fail(`Missing ${manifestPath} — run npm run sync-bundled`);
}

function walkFiles(rootDir, relDir = "") {
  const out = [];
  for (const ent of fs.readdirSync(path.join(rootDir, relDir), { withFileTypes: true })) {
    if (ent.name.startsWith(".")) {
      continue;
    }
    const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      out.push(...walkFiles(rootDir, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (e) {
  fail(`Invalid JSON in ${manifestPath}: ${e.message}`);
}
if (typeof manifest.version !== "number" || manifest.version <= 0) {
  fail(`Manifest has an invalid \`version\`: ${manifestPath}`);
}
if (!Array.isArray(manifest.files)) {
  fail(`Manifest \`files\` is not an array: ${manifestPath}`);
}

const problems = [];

const ruleFiles = walkFiles(bundleDir).sort((a, b) => a.localeCompare(b));
const unsupported = ruleFiles.filter((rel) => !rel.endsWith(".mdc"));
if (unsupported.length > 0) {
  fail(`Unsupported bundled files (expected .mdc rules): ${unsupported.join(", ")}`);
}
if (ruleFiles.length === 0) {
  fail(`No .mdc rules found in ${bundleDir}`);
}

const listed = manifest.files;

for (const rel of ruleFiles) {
  if (!listed.includes(rel)) {
    problems.push(`present in bundled/ai-rules but missing from the manifest: ${rel}`);
  }
}
for (const rel of listed) {
  if (!ruleFiles.includes(rel)) {
    problems.push(`listed in the manifest but not in bundled/ai-rules: ${rel}`);
  }
}

for (const rel of ruleFiles) {
  const body = fs.readFileSync(path.join(bundleDir, rel), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
  if (!frontmatter) {
    problems.push(`missing YAML frontmatter: ${rel}`);
  } else if (!/^description:\s*\S/m.test(frontmatter[1])) {
    problems.push(`frontmatter has no \`description\`: ${rel}`);
  }
  for (const token of body.match(/\{\{[^}]*\}\}/g) ?? []) {
    if (!KNOWN_PLACEHOLDERS.has(token)) {
      problems.push(`unrenderable placeholder ${token} in ${rel}`);
    }
  }
}

if (problems.length) {
  console.error(
    "bundled rule pack is inconsistent:\n " +
      problems.join("\n ") +
      "\nRun npm run sync-bundled if you added or removed a rule."
  );
  process.exit(1);
}

console.log(`OK: bundled rule pack is consistent (${ruleFiles.length} rules).`);
