import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  EVOLVE_RULE,
  copyManifestFiles,
  disabledName,
  globalMirrorDir,
  installBundleToRulesDir,
  isRuleEnabled,
  pathExists,
  removeGlobalMirror,
  replaceGlobalMirror,
  resetRulesDirToBundle,
  setAllMdcsEnabled,
  setRuleEnabled,
  syncBundledMdcsToClinerules,
  wasEvolveEnabledBeforeCopy,
  workspaceRulesDir,
} from "../out/rulesOperations.js";

const EVOLVE = EVOLVE_RULE;
const CLEAN = "coding-rules/write-clean-code.mdc";
const ABOUT = "ABOUT_RULES.md";

const MINI_MANIFEST = {
  version: 1,
  files: [ABOUT, CLEAN, EVOLVE],
};

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(abs, contents = "stub\n") {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

/** Mini bundle: ABOUT + clean-code active, evolve already `.disabled`. */
async function makeMiniBundle() {
  const dir = await makeTempRoot("airules-bundle-");
  await writeFile(path.join(dir, ABOUT), "# about\n");
  await writeFile(path.join(dir, CLEAN), "clean\n");
  await writeFile(path.join(dir, `${EVOLVE}.disabled`), "evolve\n");
  return dir;
}

describe("path helpers", () => {
  test("disabledName appends .disabled", () => {
    assert.equal(disabledName("a.mdc"), "a.mdc.disabled");
  });

  test("workspaceRulesDir and globalMirrorDir use the expected suffixes", () => {
    const ws = workspaceRulesDir("/tmp/proj");
    assert.equal(path.basename(path.dirname(path.dirname(ws))), ".cursor");
    assert.ok(ws.endsWith(path.join(".cursor", "rules", "ai-rules")));
    const global = globalMirrorDir("/tmp/storage");
    assert.ok(global.endsWith(path.join("ai-rules-mirror", "ai-rules")));
  });

  test("pathExists distinguishes present vs missing", async () => {
    const dir = await makeTempRoot("airules-exists-");
    const file = path.join(dir, "x.txt");
    try {
      assert.equal(await pathExists(file), false);
      await writeFile(file);
      assert.equal(await pathExists(file), true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("setRuleEnabled / isRuleEnabled", () => {
  test("rename toggles .mdc ↔ .mdc.disabled and is a no-op when already in that state", async () => {
    const dir = await makeTempRoot("airules-toggle-");
    try {
      await writeFile(path.join(dir, CLEAN), "clean\n");
      assert.equal(await isRuleEnabled(dir, CLEAN), true);

      await setRuleEnabled(dir, CLEAN, false);
      assert.equal(await isRuleEnabled(dir, CLEAN), false);
      assert.equal(await pathExists(path.join(dir, `${CLEAN}.disabled`)), true);

      await setRuleEnabled(dir, CLEAN, false);
      assert.equal(await isRuleEnabled(dir, CLEAN), false);

      await setRuleEnabled(dir, CLEAN, true);
      assert.equal(await isRuleEnabled(dir, CLEAN), true);
      assert.equal(await pathExists(path.join(dir, `${CLEAN}.disabled`)), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("enabling when both active and disabled exist drops the disabled copy", async () => {
    const dir = await makeTempRoot("airules-both-");
    try {
      await writeFile(path.join(dir, CLEAN), "active\n");
      await writeFile(path.join(dir, `${CLEAN}.disabled`), "off\n");
      await setRuleEnabled(dir, CLEAN, true);
      assert.equal(await isRuleEnabled(dir, CLEAN), true);
      assert.equal(await pathExists(path.join(dir, `${CLEAN}.disabled`)), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses an unsafe relative path before touching disk", async () => {
    const dir = await makeTempRoot("airules-unsafe-");
    try {
      await assert.rejects(() => setRuleEnabled(dir, "../escape.mdc", true), /Refusing unsafe rule path/);
      await assert.rejects(() => isRuleEnabled(dir, "/etc/passwd"), /Refusing unsafe rule path/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("setAllMdcsEnabled flips every listed rule", async () => {
    const dir = await makeTempRoot("airules-all-");
    try {
      await writeFile(path.join(dir, CLEAN), "clean\n");
      await writeFile(path.join(dir, EVOLVE), "evolve\n");
      await setAllMdcsEnabled(dir, [CLEAN, EVOLVE], false);
      assert.equal(await isRuleEnabled(dir, CLEAN), false);
      assert.equal(await isRuleEnabled(dir, EVOLVE), false);
      await setAllMdcsEnabled(dir, [CLEAN, EVOLVE], true);
      assert.equal(await isRuleEnabled(dir, CLEAN), true);
      assert.equal(await isRuleEnabled(dir, EVOLVE), true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("installBundleToRulesDir", () => {
  test("copies pack files, preserves unknown extras, and turns evolve off by default", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-install-");
    try {
      await writeFile(path.join(rules, "user-extra.mdc"), "keep me\n");
      await installBundleToRulesDir(bundle, rules, MINI_MANIFEST, {
        applyEvolveOffUnlessWasEnabled: true,
      });
      assert.equal(await fs.readFile(path.join(rules, ABOUT), "utf8"), "# about\n");
      assert.equal(await isRuleEnabled(rules, CLEAN), true);
      assert.equal(await isRuleEnabled(rules, EVOLVE), false);
      assert.equal(await pathExists(path.join(rules, "user-extra.mdc")), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("keeps evolve enabled when it was already on before copy", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-evolve-on-");
    try {
      await writeFile(path.join(rules, EVOLVE), "already on\n");
      assert.equal(await wasEvolveEnabledBeforeCopy(rules), true);
      await installBundleToRulesDir(bundle, rules, MINI_MANIFEST, {
        applyEvolveOffUnlessWasEnabled: true,
      });
      assert.equal(await isRuleEnabled(rules, EVOLVE), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("stores a bundled .mdc.disabled file as disabled in the destination", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-disabled-src-");
    try {
      await installBundleToRulesDir(bundle, rules, MINI_MANIFEST, {
        applyEvolveOffUnlessWasEnabled: false,
      });
      assert.equal(await isRuleEnabled(rules, EVOLVE), false);
      assert.equal(await pathExists(path.join(rules, `${EVOLVE}.disabled`)), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("throws when a logical .mdc is missing from the bundle", async () => {
    const bundle = await makeTempRoot("airules-missing-");
    const rules = await makeTempRoot("airules-missing-dest-");
    try {
      await writeFile(path.join(bundle, ABOUT), "# about\n");
      await assert.rejects(
        () =>
          installBundleToRulesDir(
            bundle,
            rules,
            { version: 1, files: [ABOUT, CLEAN] },
            { applyEvolveOffUnlessWasEnabled: false }
          ),
        /Bundled pack missing/
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });
});

describe("copyManifestFiles", () => {
  test("mirrors active and disabled variants into the destination", async () => {
    const source = await makeMiniBundle();
    const dest = await makeTempRoot("airules-copy-");
    try {
      await copyManifestFiles(source, dest, MINI_MANIFEST);
      assert.equal(await isRuleEnabled(dest, CLEAN), true);
      assert.equal(await isRuleEnabled(dest, EVOLVE), false);
      assert.equal(await fs.readFile(path.join(dest, ABOUT), "utf8"), "# about\n");
    } finally {
      await fs.rm(source, { recursive: true, force: true });
      await fs.rm(dest, { recursive: true, force: true });
    }
  });
});

describe("resetRulesDirToBundle", () => {
  test("refuses a path that is not .cursor/rules/ai-rules", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-reset-bad-");
    try {
      await assert.rejects(
        () => resetRulesDirToBundle(bundle, rules, MINI_MANIFEST),
        /Refusing to delete workspace rules folder/
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("replaces the folder, disables evolve, and drops unshipped files", async () => {
    const bundle = await makeMiniBundle();
    const root = await makeTempRoot("airules-reset-ok-");
    const rules = path.join(root, ".cursor", "rules", "ai-rules");
    try {
      await writeFile(path.join(rules, "orphan.mdc"), "gone\n");
      await writeFile(path.join(rules, EVOLVE), "was on\n");
      await resetRulesDirToBundle(bundle, rules, MINI_MANIFEST);
      assert.equal(await pathExists(path.join(rules, "orphan.mdc")), false);
      assert.equal(await isRuleEnabled(rules, CLEAN), true);
      assert.equal(await isRuleEnabled(rules, EVOLVE), false);
      assert.equal(await fs.readFile(path.join(rules, ABOUT), "utf8"), "# about\n");
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("does not copy a symlink from the bundle", async () => {
    const bundle = await makeMiniBundle();
    const root = await makeTempRoot("airules-reset-link-");
    const rules = path.join(root, ".cursor", "rules", "ai-rules");
    const outside = path.join(root, "secret.txt");
    try {
      await writeFile(outside, "secret\n");
      await fs.symlink(outside, path.join(bundle, "link.mdc"));
      await resetRulesDirToBundle(bundle, rules, MINI_MANIFEST);
      assert.equal(await pathExists(path.join(rules, "link.mdc")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("global mirror", () => {
  test("replace and remove refuse a path that is not ai-rules-mirror/ai-rules", async () => {
    const bundle = await makeMiniBundle();
    const dir = await makeTempRoot("airules-global-bad-");
    try {
      await assert.rejects(
        () => replaceGlobalMirror(dir, bundle),
        /Refusing to delete global mirror/
      );
      await assert.rejects(() => removeGlobalMirror(dir), /Refusing to delete global mirror/);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("replace copies the bundle and remove deletes it", async () => {
    const bundle = await makeMiniBundle();
    const storage = await makeTempRoot("airules-global-ok-");
    const globalDir = globalMirrorDir(storage);
    try {
      await replaceGlobalMirror(globalDir, bundle);
      assert.equal(await pathExists(path.join(globalDir, CLEAN)), true);
      await removeGlobalMirror(globalDir);
      assert.equal(await pathExists(globalDir), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(storage, { recursive: true, force: true });
    }
  });
});

describe("syncBundledMdcsToClinerules", () => {
  test("flattens nested .mdc paths into ai-rules-*.md files", async () => {
    const bundle = await makeMiniBundle();
    const workspace = await makeTempRoot("airules-cline-");
    try {
      await syncBundledMdcsToClinerules(workspace, bundle, MINI_MANIFEST);
      const dest = path.join(workspace, ".clinerules", "ai-rules");
      const cleanMirror = path.join(dest, "ai-rules-coding-rules-write-clean-code.md");
      const evolveMirror = path.join(
        dest,
        "ai-rules-rules-for-rules-evolve-rules-when-codebase-patterns-change.md"
      );
      assert.equal(await fs.readFile(cleanMirror, "utf8"), "clean\n");
      assert.equal(await fs.readFile(evolveMirror, "utf8"), "evolve\n");
      assert.equal(await pathExists(path.join(dest, ABOUT)), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
