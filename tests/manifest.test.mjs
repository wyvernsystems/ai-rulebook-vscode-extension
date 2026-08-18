import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

import { listBundledMdcs, readBundleManifest } from "../out/manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function writeExtensionRoot(manifest) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "airules-manifest-"));
  await fs.mkdir(path.join(dir, "bundled"), { recursive: true });
  await fs.writeFile(path.join(dir, "bundled", "manifest.json"), manifest, "utf8");
  return dir;
}

describe("readBundleManifest (shipped pack)", () => {
  test("loads the repo bundled manifest and lists only .mdc files", () => {
    const manifest = readBundleManifest(repoRoot);
    assert.equal(manifest.version, 1);
    assert.ok(manifest.files.includes("ABOUT_RULES.md"));
    assert.ok(manifest.files.includes("coding-rules/write-clean-code.mdc"));
    const mdcs = listBundledMdcs(manifest);
    assert.ok(mdcs.every((f) => f.endsWith(".mdc")));
    assert.ok(!mdcs.includes("ABOUT_RULES.md"));
    assert.equal(mdcs.length, manifest.files.filter((f) => f.endsWith(".mdc")).length);
  });
});

describe("readBundleManifest validation", () => {
  test("rejects invalid JSON", async () => {
    const dir = await writeExtensionRoot("{not json");
    try {
      assert.throws(() => readBundleManifest(dir), /Invalid bundled manifest JSON/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a non-object root", async () => {
    const dir = await writeExtensionRoot("null");
    try {
      assert.throws(() => readBundleManifest(dir), /Manifest is not an object/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects missing or non-positive version", async () => {
    const dir = await writeExtensionRoot(JSON.stringify({ files: [] }));
    try {
      assert.throws(() => readBundleManifest(dir), /invalid `version`/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a non-array files field", async () => {
    const dir = await writeExtensionRoot(JSON.stringify({ version: 1, files: "nope" }));
    try {
      assert.throws(() => readBundleManifest(dir), /`files` is not an array/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a traversal entry", async () => {
    const dir = await writeExtensionRoot(
      JSON.stringify({ version: 1, files: ["coding-rules/ok.mdc", "../escape.mdc"] })
    );
    try {
      assert.throws(() => readBundleManifest(dir), /unsafe entry/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("accepts a minimal valid manifest", async () => {
    const dir = await writeExtensionRoot(
      JSON.stringify({ version: 1, files: ["ABOUT_RULES.md", "coding-rules/x.mdc"] })
    );
    try {
      const manifest = readBundleManifest(dir);
      assert.deepEqual(manifest, {
        version: 1,
        files: ["ABOUT_RULES.md", "coding-rules/x.mdc"],
      });
      assert.deepEqual(listBundledMdcs(manifest), ["coding-rules/x.mdc"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
