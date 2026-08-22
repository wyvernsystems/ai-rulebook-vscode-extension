import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  ensureAiRulesIgnored,
  GENERATED_RULE_IGNORE_ENTRIES,
  installCoreRule,
  isRuleEnabled,
  pathExists,
  resetRulesDirToBundle,
  setRuleEnabled,
  syncBundledMdcsToClinerules,
  workspaceRulesDir,
} from "../out/rulesOperations.js";

const CORE = "core.mdc";

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(abs, contents = "stub\n") {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

async function makeMiniBundle() {
  const dir = await makeTempRoot("airules-bundle-");
  await writeFile(path.join(dir, CORE), "core\n");
  return dir;
}

describe("path helpers", () => {
  test("workspaceRulesDir uses the expected suffix", () => {
    const ws = workspaceRulesDir("/tmp/proj");
    assert.equal(path.basename(path.dirname(path.dirname(ws))), ".cursor");
    assert.ok(ws.endsWith(path.join(".cursor", "rules", "ai-rules")));
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

describe("ensureAiRulesIgnored", () => {
  test("creates .gitignore with Cursor and Cline rule folders", async () => {
    const root = await makeTempRoot("airules-ignore-new-");
    try {
      await ensureAiRulesIgnored(root);

      const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
      assert.equal(gitignore, `${GENERATED_RULE_IGNORE_ENTRIES.join("\n")}\n`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("appends missing entries without changing existing content", async () => {
    const root = await makeTempRoot("airules-ignore-existing-");
    try {
      await writeFile(path.join(root, ".gitignore"), "node_modules/");
      await ensureAiRulesIgnored(root);

      const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
      assert.equal(
        gitignore,
        `node_modules/\n${GENERATED_RULE_IGNORE_ENTRIES.join("\n")}\n`
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("recognizes equivalent entries and remains idempotent", async () => {
    const root = await makeTempRoot("airules-ignore-idempotent-");
    const initial = ".cursor/rules/ai-rules\n/.clinerules/ai-rules/\n";
    try {
      await writeFile(path.join(root, ".gitignore"), initial);
      await ensureAiRulesIgnored(root);
      await ensureAiRulesIgnored(root);

      assert.equal(await fs.readFile(path.join(root, ".gitignore"), "utf8"), initial);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("setRuleEnabled / isRuleEnabled", () => {
  test("rename toggles .mdc ↔ .mdc.disabled and is a no-op when already in that state", async () => {
    const dir = await makeTempRoot("airules-toggle-");
    try {
      await writeFile(path.join(dir, CORE), "core\n");
      assert.equal(await isRuleEnabled(dir, CORE), true);

      await setRuleEnabled(dir, CORE, false);
      assert.equal(await isRuleEnabled(dir, CORE), false);
      assert.equal(await pathExists(path.join(dir, `${CORE}.disabled`)), true);

      await setRuleEnabled(dir, CORE, false);
      assert.equal(await isRuleEnabled(dir, CORE), false);

      await setRuleEnabled(dir, CORE, true);
      assert.equal(await isRuleEnabled(dir, CORE), true);
      assert.equal(await pathExists(path.join(dir, `${CORE}.disabled`)), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("enabling when both active and disabled exist drops the disabled copy", async () => {
    const dir = await makeTempRoot("airules-both-");
    try {
      await writeFile(path.join(dir, CORE), "active\n");
      await writeFile(path.join(dir, `${CORE}.disabled`), "off\n");
      await setRuleEnabled(dir, CORE, true);
      assert.equal(await isRuleEnabled(dir, CORE), true);
      assert.equal(await pathExists(path.join(dir, `${CORE}.disabled`)), false);
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

});

describe("installCoreRule", () => {
  test("installs core.mdc and preserves unrelated workspace files", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-install-");
    try {
      await writeFile(path.join(rules, "user-extra.mdc"), "keep me\n");
      await installCoreRule(bundle, rules);
      assert.equal(await isRuleEnabled(rules, CORE), true);
      assert.equal(await pathExists(path.join(rules, "user-extra.mdc")), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("removes a stale disabled core before installing", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-active-converge-");
    try {
      await writeFile(path.join(rules, `${CORE}.disabled`), "stale disabled\n");

      await installCoreRule(bundle, rules);

      assert.equal(await isRuleEnabled(rules, CORE), true);
      assert.equal(await pathExists(path.join(rules, `${CORE}.disabled`)), false);
      assert.equal(await fs.readFile(path.join(rules, CORE), "utf8"), "core\n");
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("throws when core.mdc is missing from the bundle", async () => {
    const bundle = await makeTempRoot("airules-missing-");
    const rules = await makeTempRoot("airules-missing-dest-");
    try {
      await assert.rejects(() => installCoreRule(bundle, rules), /Bundled core rule missing/);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });
});

describe("resetRulesDirToBundle", () => {
  test("refuses a path that is not .cursor/rules/ai-rules", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-reset-bad-");
    try {
      await assert.rejects(
        () => resetRulesDirToBundle(bundle, rules),
        /Refusing to delete workspace rules folder/
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("replaces the folder and drops unshipped files", async () => {
    const bundle = await makeMiniBundle();
    const root = await makeTempRoot("airules-reset-ok-");
    const rules = path.join(root, ".cursor", "rules", "ai-rules");
    try {
      await writeFile(path.join(rules, "orphan.mdc"), "gone\n");
      await resetRulesDirToBundle(bundle, rules);
      assert.equal(await pathExists(path.join(rules, "orphan.mdc")), false);
      assert.equal(await isRuleEnabled(rules, CORE), true);
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
      await resetRulesDirToBundle(bundle, rules);
      assert.equal(await pathExists(path.join(rules, "link.mdc")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("syncBundledMdcsToClinerules", () => {
  test("mirrors only core.mdc as ai-rules-core.md", async () => {
    const bundle = await makeMiniBundle();
    const workspace = await makeTempRoot("airules-cline-");
    try {
      await syncBundledMdcsToClinerules(workspace, bundle);
      const dest = path.join(workspace, ".clinerules", "ai-rules");
      const coreMirror = path.join(dest, "ai-rules-core.md");
      assert.equal(await fs.readFile(coreMirror, "utf8"), "core\n");
      const gitignore = await fs.readFile(path.join(workspace, ".gitignore"), "utf8");
      assert.equal(gitignore, `${GENERATED_RULE_IGNORE_ENTRIES.join("\n")}\n`);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
