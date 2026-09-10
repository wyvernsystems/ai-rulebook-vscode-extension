#!/usr/bin/env node
/**
 * Regenerates `bundled/manifest.json` from the rule files in
 * `bundled/ai-rules/`.
 *
 * Only `.mdc` source rules belong in this bundle. Workspace rule state lives
 * in the managed `AGENTS.md` block, never in source filenames.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bundleDir = path.join(repoRoot, "bundled", "ai-rules");
const manifestPath = path.join(repoRoot, "bundled", "manifest.json");

if (!fs.existsSync(bundleDir)) {
  console.error("Missing rule pack source:", bundleDir);
  process.exit(1);
}

function listShippedFiles(rootDir) {
  const out = [];
  const walk = (relDir) => {
    const abs = path.join(rootDir, relDir);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) {
        continue;
      }
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk("");
  return out.sort();
}

const manifestFiles = listShippedFiles(bundleDir).sort((a, b) => a.localeCompare(b));
const unsupported = manifestFiles.filter((rel) => !rel.endsWith(".mdc"));
if (unsupported.length > 0) {
  console.error("Unsupported bundled files (expected .mdc rules):", unsupported.join(", "));
  process.exit(1);
}
if (manifestFiles.length === 0) {
  console.error("No .mdc rules found in", bundleDir);
  process.exit(1);
}

fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files: manifestFiles }, null, 2) + "\n", "utf8");
console.log("Wrote bundled/manifest.json with", manifestFiles.length, "entries.");
