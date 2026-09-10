import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

async function withBundle(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "airules-scripts-"));
  try {
    await fs.mkdir(path.join(root, "scripts"));
    await fs.mkdir(path.join(root, "bundled", "ai-rules"), { recursive: true });
    for (const script of ["sync-bundled.mjs", "verify-bundled.mjs", "build-standalone.mjs"]) {
      await fs.copyFile(new URL(`../scripts/${script}`, import.meta.url), path.join(root, "scripts", script));
    }
    await fs.writeFile(path.join(root, "bundled", "ai-rules", "code.mdc"),
      "---\ndescription: Code\n---\n\n# Code\n\n- Reuse helpers.\n");
    await fs.writeFile(path.join(root, "bundled", "manifest.json"),
      JSON.stringify({ version: 1, files: ["code.mdc"] }) + "\n");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("build-standalone.mjs validates the manifest before writing output", async () => {
  await withBundle(async (root) => {
    await fs.cp(new URL("../out/", import.meta.url), path.join(root, "out"), { recursive: true });
    await fs.writeFile(path.join(root, "bundled", "manifest.json"),
      JSON.stringify({ version: 0, files: ["code.mdc"] }));
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-standalone.mjs")], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Manifest has invalid `version`/);
    await assert.rejects(fs.access(path.join(root, "bundled", "standalone")), { code: "ENOENT" });
  });
});

for (const script of ["sync-bundled.mjs", "verify-bundled.mjs"]) {
  test(`${script} accepts a bundle containing only .mdc rules`, async () => {
    await withBundle(async (root) => {
      const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "bundled", "manifest.json"), "utf8")),
        { version: 1, files: ["code.mdc"] });
    });
  });

  for (const filename of ["docs.mdc.disabled", "notes.md"]) {
    test(`${script} rejects unsupported bundle file ${filename}`, async () => {
      await withBundle(async (root) => {
        await fs.copyFile(path.join(root, "bundled", "ai-rules", "code.mdc"),
          path.join(root, "bundled", "ai-rules", filename));
        // The old verifier accepted these files when the manifest listed them.
        const manifest = JSON.stringify({ version: 1, files: ["code.mdc", filename.replace(/\.disabled$/, "")] }) + "\n";
        await fs.writeFile(path.join(root, "bundled", "manifest.json"), manifest);
        const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { encoding: "utf8" });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(result.stderr.includes(filename), result.stderr);
        assert.equal(await fs.readFile(path.join(root, "bundled", "manifest.json"), "utf8"), manifest);
      });
    });
  }
}
