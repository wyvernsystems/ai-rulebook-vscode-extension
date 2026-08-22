import * as fs from "node:fs";
import * as path from "node:path";
import { isSafeManifestEntry } from "./safePaths";

export type BundleManifest = {
  version: number;
  files: readonly string[];
};

export function readBundleManifest(extensionRoot: string): BundleManifest {
  const manifestPath = path.join(extensionRoot, "bundled", "manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid bundled manifest JSON at ${manifestPath}: ${reason}`);
  }
  return validateManifest(parsed, manifestPath);
}

function validateManifest(value: unknown, source: string): BundleManifest {
  if (!value || typeof value !== "object") {
    throw new Error(`Manifest is not an object: ${source}`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version <= 0 || !Number.isFinite(obj.version)) {
    throw new Error(`Manifest has invalid \`version\`: ${source}`);
  }
  if (!Array.isArray(obj.files)) {
    throw new Error(`Manifest \`files\` is not an array: ${source}`);
  }
  const files: string[] = [];
  for (const entry of obj.files) {
    if (!isSafeManifestEntry(entry)) {
      throw new Error(`Manifest contains an unsafe entry (${JSON.stringify(entry)}) in ${source}`);
    }
    files.push(entry);
  }
  return { version: obj.version, files };
}
