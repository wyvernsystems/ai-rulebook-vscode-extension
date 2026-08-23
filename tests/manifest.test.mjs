import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

import { readBundleManifest } from "../out/manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const RULE_FILES = [
  "code.mdc",
  "docs.mdc",
  "git.mdc",
  "markdown.mdc",
  "scope.mdc",
  "tests.mdc",
];

async function writeExtensionRoot(manifest) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "airules-manifest-"));
  await fs.mkdir(path.join(dir, "bundled"), { recursive: true });
  await fs.writeFile(path.join(dir, "bundled", "manifest.json"), manifest, "utf8");
  return dir;
}

describe("readBundleManifest (shipped pack)", () => {
  test("loads the topic-based bundled manifest", () => {
    const manifest = readBundleManifest(repoRoot);
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.files, RULE_FILES);
  });

  test("manifest lists exactly the rule files present in the bundle", async () => {
    // bundled/ai-rules is the tracked source of truth, so a rule added or
    // removed without regenerating the manifest must fail the suite, not just
    // `npm run verify:bundled`.
    const bundleDir = path.join(repoRoot, "bundled", "ai-rules");
    const onDisk = (await fs.readdir(bundleDir))
      .filter((name) => name.endsWith(".mdc") || name.endsWith(".mdc.disabled"))
      .map((name) => (name.endsWith(".disabled") ? name.slice(0, -".disabled".length) : name))
      .sort((a, b) => a.localeCompare(b));

    assert.deepEqual(readBundleManifest(repoRoot).files, onDisk);
  });

  test("ships behavior rules as always-on and formatting rules as glob-scoped", async () => {
    // markdown.mdc only applies while editing Markdown, so it costs nothing on
    // other turns. Every other rule must be live while code is being written.
    const GLOB_SCOPED = new Set(["markdown.mdc"]);

    for (const ruleFile of RULE_FILES) {
      const rule = await fs.readFile(
        path.join(repoRoot, "bundled", "ai-rules", ruleFile),
        "utf8"
      );
      if (GLOB_SCOPED.has(ruleFile)) {
        assert.match(rule, /^---\n(?:[^\n]*\n)*globs: "[^"]+"\n(?:[^\n]*\n)*---\n/, ruleFile);
        assert.match(
          rule,
          /^---\n(?:[^\n]*\n)*alwaysApply: false\n(?:[^\n]*\n)*---\n/,
          ruleFile
        );
      } else {
        assert.match(
          rule,
          /^---\n(?:[^\n]*\n)*alwaysApply: true\n(?:[^\n]*\n)*---\n/,
          ruleFile
        );
      }
    }
  });

  test("ships no placeholder that install-time rendering does not resolve", async () => {
    const { TEST_COMMAND_PLACEHOLDER, renderRuleBody } = await import(
      "../out/testCommand.js"
    );

    for (const ruleFile of RULE_FILES) {
      const rule = await fs.readFile(
        path.join(repoRoot, "bundled", "ai-rules", ruleFile),
        "utf8"
      );
      const unknown = rule
        .replaceAll(TEST_COMMAND_PLACEHOLDER, "")
        .match(/\{\{[^}]*\}\}|<your [^>]*>/g);
      assert.equal(unknown, null, `${ruleFile} ships an unrenderable placeholder`);
      assert.ok(!renderRuleBody(rule, "npm test").includes("{{"), ruleFile);
      assert.ok(!renderRuleBody(rule, null).includes("{{"), ruleFile);
    }
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
      JSON.stringify({ version: 1, files: ["core.mdc", "../escape.mdc"] })
    );
    try {
      assert.throws(() => readBundleManifest(dir), /unsafe entry/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("accepts a minimal valid manifest", async () => {
    const dir = await writeExtensionRoot(
      JSON.stringify({ version: 1, files: ["core.mdc"] })
    );
    try {
      const manifest = readBundleManifest(dir);
      assert.deepEqual(manifest, {
        version: 1,
        files: ["core.mdc"],
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
