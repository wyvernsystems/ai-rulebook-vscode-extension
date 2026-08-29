#!/usr/bin/env node
/**
 * Zips each folder under `bundled/rule-packs/` into a standalone
 * `ai-rulebook-rules-<tool>-X.Y.Z.zip` at the repository root, for attaching
 * to a GitHub release alongside the `.vsix`. Lets someone grab just the
 * rules for one tool without installing the extension.
 *
 * Requires the `zip` CLI (present by default on macOS and Linux). Run
 * `npm run sync-bundled` first if `bundled/rule-packs/` might be stale.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const packsRoot = path.join(repoRoot, "bundled", "rule-packs");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;

if (!fs.existsSync(packsRoot)) {
  console.error(
    "Missing",
    path.relative(repoRoot, packsRoot),
    "— run `npm run sync-bundled` first."
  );
  process.exit(1);
}

const packDirs = fs
  .readdirSync(packsRoot, { withFileTypes: true })
  .filter((ent) => ent.isDirectory())
  .map((ent) => ent.name)
  .sort((a, b) => a.localeCompare(b));

if (packDirs.length === 0) {
  console.error("No rule pack folders found under", path.relative(repoRoot, packsRoot));
  process.exit(1);
}

const written = [];
for (const packId of packDirs) {
  const zipName = `ai-rulebook-rules-${packId}-${version}.zip`;
  const zipPath = path.join(repoRoot, zipName);
  fs.rmSync(zipPath, { force: true });
  // -X: no extended attrs (deterministic-ish output); run from inside the
  // pack folder so the archive doesn't carry the full repo path as a prefix.
  execFileSync("zip", ["-rX", zipPath, "."], {
    cwd: path.join(packsRoot, packId),
    stdio: "inherit",
  });
  written.push(zipName);
}

console.log("Wrote", written.length, "rule pack archives:", written.join(", "));
