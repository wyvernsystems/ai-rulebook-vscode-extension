import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  convertCursorRuleToClaudeRule,
  ensureOpencodeInstructionsEntry,
  installRulePack,
  isRuleEnabled,
  mirrorRuleToClaudeCode,
  mirrorRuleToOpencode,
  OPENCODE_RULES_GLOB,
  pathExists,
  resetRulesDirToBundle,
  resolveOpencodeConfigPath,
  setRuleEnabled,
  stripCursorFrontmatter,
  syncBundledMdcsToClaudeRules,
  syncBundledMdcsToClinerules,
  syncBundledMdcsToOpencodeRules,
  syncClaudeMirrorFromWorkspace,
  syncOpencodeMirrorFromWorkspace,
  workspaceClaudeRulesDir,
  workspaceRulesDir,
  workspaceUsesClaudeCode,
  workspaceUsesOpencode,
} from "../out/rulesOperations.js";
import {
  TEST_COMMAND_PLACEHOLDER,
  UNKNOWN_TEST_COMMAND_TEXT,
} from "../out/testCommand.js";

const RULE_FILES = [
  "code.mdc",
  "docs.mdc",
  "git.mdc",
  "markdown.mdc",
  "scope.mdc",
  "tests.mdc",
];
const SAMPLE_RULE = RULE_FILES[0];

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(abs, contents = "stub\n") {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

async function makeMiniBundle() {
  const dir = await makeTempRoot("airules-bundle-");
  await Promise.all(
    RULE_FILES.map((ruleFile) => writeFile(path.join(dir, ruleFile), `${ruleFile}\n`))
  );
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

describe("the workspace .gitignore is never touched", () => {
  // Rule folders are meant to be committable, so a team shares one pack.
  // Ignoring them was self-defeating: the rules the extension installs would
  // never reach anyone else's checkout.
  test("installing does not create a .gitignore", async () => {
    const bundle = await makeMiniBundle();
    const root = await makeTempRoot("airules-nogitignore-install-");
    try {
      await installRulePack(bundle, workspaceRulesDir(root), RULE_FILES, null);
      assert.equal(await pathExists(path.join(root, ".gitignore")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("the Cline, opencode, and Claude Code mirrors leave an existing .gitignore byte-identical", async () => {
    const bundle = await makeMiniBundle();
    const workspace = await makeTempRoot("airules-nogitignore-mirrors-");
    const original = "node_modules/\ndist/\n";
    try {
      await writeFile(path.join(workspace, ".gitignore"), original);

      await syncBundledMdcsToClinerules(workspace, bundle, RULE_FILES, null);
      await syncBundledMdcsToOpencodeRules(workspace, bundle, RULE_FILES, null);
      await syncBundledMdcsToClaudeRules(workspace, bundle, RULE_FILES, null);

      assert.equal(
        await fs.readFile(path.join(workspace, ".gitignore"), "utf8"),
        original
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("the module no longer exports gitignore helpers", async () => {
    const mod = await import("../out/rulesOperations.js");
    assert.equal(mod.ensureAiRulesIgnored, undefined);
    assert.equal(mod.GENERATED_RULE_IGNORE_ENTRIES, undefined);
  });
});

describe("setRuleEnabled / isRuleEnabled", () => {
  test("rename toggles .mdc ↔ .mdc.disabled and is a no-op when already in that state", async () => {
    const dir = await makeTempRoot("airules-toggle-");
    try {
      await writeFile(path.join(dir, SAMPLE_RULE), "code\n");
      assert.equal(await isRuleEnabled(dir, SAMPLE_RULE), true);

      await setRuleEnabled(dir, SAMPLE_RULE, false);
      assert.equal(await isRuleEnabled(dir, SAMPLE_RULE), false);
      assert.equal(await pathExists(path.join(dir, `${SAMPLE_RULE}.disabled`)), true);

      await setRuleEnabled(dir, SAMPLE_RULE, false);
      assert.equal(await isRuleEnabled(dir, SAMPLE_RULE), false);

      await setRuleEnabled(dir, SAMPLE_RULE, true);
      assert.equal(await isRuleEnabled(dir, SAMPLE_RULE), true);
      assert.equal(await pathExists(path.join(dir, `${SAMPLE_RULE}.disabled`)), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("enabling when both active and disabled exist drops the disabled copy", async () => {
    const dir = await makeTempRoot("airules-both-");
    try {
      await writeFile(path.join(dir, SAMPLE_RULE), "active\n");
      await writeFile(path.join(dir, `${SAMPLE_RULE}.disabled`), "off\n");
      await setRuleEnabled(dir, SAMPLE_RULE, true);
      assert.equal(await isRuleEnabled(dir, SAMPLE_RULE), true);
      assert.equal(await pathExists(path.join(dir, `${SAMPLE_RULE}.disabled`)), false);
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

describe("installRulePack", () => {
  test("installs every rule and preserves unrelated workspace files", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-install-");
    try {
      await writeFile(path.join(rules, "user-extra.mdc"), "keep me\n");
      await installRulePack(bundle, rules, RULE_FILES, null);
      for (const ruleFile of RULE_FILES) {
        assert.equal(await isRuleEnabled(rules, ruleFile), true);
      }
      assert.equal(await pathExists(path.join(rules, "user-extra.mdc")), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("removes stale disabled and legacy core rules before installing", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-active-converge-");
    try {
      await writeFile(path.join(rules, `${SAMPLE_RULE}.disabled`), "stale disabled\n");
      await writeFile(path.join(rules, "core.mdc"), "legacy\n");

      await installRulePack(bundle, rules, RULE_FILES, null);

      assert.equal(await isRuleEnabled(rules, SAMPLE_RULE), true);
      assert.equal(await pathExists(path.join(rules, `${SAMPLE_RULE}.disabled`)), false);
      assert.equal(await pathExists(path.join(rules, "core.mdc")), false);
      assert.equal(
        await fs.readFile(path.join(rules, SAMPLE_RULE), "utf8"),
        `${SAMPLE_RULE}\n`
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("throws when a listed rule is missing from the bundle", async () => {
    const bundle = await makeTempRoot("airules-missing-");
    const rules = await makeTempRoot("airules-missing-dest-");
    try {
      await assert.rejects(
        () => installRulePack(bundle, rules, RULE_FILES, null),
        /Bundled rule missing: .*\.mdc/
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });
});

describe("install-time test command rendering", () => {
  const RULE_WITH_PLACEHOLDER =
    `---\ndescription: x\nalwaysApply: true\n---\n\n# Tests\n\n- Then run ${TEST_COMMAND_PLACEHOLDER}.\n`;

  async function bundleWithPlaceholder() {
    const dir = await makeTempRoot("airules-placeholder-bundle-");
    await writeFile(path.join(dir, SAMPLE_RULE), RULE_WITH_PLACEHOLDER);
    return dir;
  }

  test("installRulePack substitutes the detected command", async () => {
    const bundle = await bundleWithPlaceholder();
    const rules = await makeTempRoot("airules-placeholder-install-");
    try {
      await installRulePack(bundle, rules, [SAMPLE_RULE], "npm test");
      const installed = await fs.readFile(path.join(rules, SAMPLE_RULE), "utf8");
      assert.ok(installed.includes("- Then run `npm test`."));
      assert.ok(!installed.includes(TEST_COMMAND_PLACEHOLDER));
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("installRulePack falls back to prose when nothing was detected", async () => {
    const bundle = await bundleWithPlaceholder();
    const rules = await makeTempRoot("airules-placeholder-fallback-");
    try {
      await installRulePack(bundle, rules, [SAMPLE_RULE], null);
      const installed = await fs.readFile(path.join(rules, SAMPLE_RULE), "utf8");
      assert.ok(installed.includes(`- Then run ${UNKNOWN_TEST_COMMAND_TEXT}.`));
      assert.ok(!installed.includes(TEST_COMMAND_PLACEHOLDER));
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(rules, { recursive: true, force: true });
    }
  });

  test("resetRulesDirToBundle renders the restored files", async () => {
    const bundle = await bundleWithPlaceholder();
    const root = await makeTempRoot("airules-placeholder-reset-");
    const rules = path.join(root, ".cursor", "rules", "ai-rules");
    try {
      await resetRulesDirToBundle(bundle, rules, "cargo test");
      const restored = await fs.readFile(path.join(rules, SAMPLE_RULE), "utf8");
      assert.ok(restored.includes("- Then run `cargo test`."));
      assert.ok(!restored.includes(TEST_COMMAND_PLACEHOLDER));
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("the Cline and opencode mirrors render the same command", async () => {
    const bundle = await bundleWithPlaceholder();
    const workspace = await makeTempRoot("airules-placeholder-mirrors-");
    try {
      await syncBundledMdcsToClinerules(workspace, bundle, [SAMPLE_RULE], "pytest");
      const cline = await fs.readFile(
        path.join(workspace, ".clinerules", "ai-rules", "ai-rules-code.md"),
        "utf8"
      );
      assert.ok(cline.includes("- Then run `pytest`."));

      await syncBundledMdcsToOpencodeRules(workspace, bundle, [SAMPLE_RULE], "pytest");
      const opencode = await fs.readFile(
        path.join(workspace, ".opencode", "rules", "ai-rules", "code.md"),
        "utf8"
      );
      assert.ok(opencode.includes("- Then run `pytest`."));
      assert.ok(!opencode.includes(TEST_COMMAND_PLACEHOLDER));

      await syncBundledMdcsToClaudeRules(workspace, bundle, [SAMPLE_RULE], "pytest");
      const claude = await fs.readFile(
        path.join(workspace, ".claude", "rules", "ai-rules", "code.md"),
        "utf8"
      );
      assert.ok(claude.includes("- Then run `pytest`."));
      assert.ok(!claude.includes(TEST_COMMAND_PLACEHOLDER));
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("resetRulesDirToBundle", () => {
  test("refuses a path that is not .cursor/rules/ai-rules", async () => {
    const bundle = await makeMiniBundle();
    const rules = await makeTempRoot("airules-reset-bad-");
    try {
      await assert.rejects(
        () => resetRulesDirToBundle(bundle, rules, null),
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
      await resetRulesDirToBundle(bundle, rules, null);
      assert.equal(await pathExists(path.join(rules, "orphan.mdc")), false);
      assert.equal(await isRuleEnabled(rules, SAMPLE_RULE), true);
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
      await resetRulesDirToBundle(bundle, rules, null);
      assert.equal(await pathExists(path.join(rules, "link.mdc")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("syncBundledMdcsToClinerules", () => {
  test("mirrors every topic rule and removes the legacy core mirror", async () => {
    const bundle = await makeMiniBundle();
    const workspace = await makeTempRoot("airules-cline-");
    try {
      const dest = path.join(workspace, ".clinerules", "ai-rules");
      await writeFile(path.join(dest, "ai-rules-core.md"), "legacy\n");
      await syncBundledMdcsToClinerules(workspace, bundle, RULE_FILES, null);
      for (const ruleFile of RULE_FILES) {
        const mirror = path.join(dest, `ai-rules-${ruleFile.replace(".mdc", ".md")}`);
        assert.equal(await fs.readFile(mirror, "utf8"), `${ruleFile}\n`);
      }
      assert.equal(await pathExists(path.join(dest, "ai-rules-core.md")), false);
      assert.equal(await pathExists(path.join(workspace, ".gitignore")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("stripCursorFrontmatter", () => {
  test("removes the frontmatter block and keeps the body", () => {
    const body = "---\ndescription: Task scope\nalwaysApply: true\n---\n\n# Scope\n\n- Change only what the task requires.\n";
    assert.equal(
      stripCursorFrontmatter(body),
      "\n# Scope\n\n- Change only what the task requires.\n"
    );
  });

  test("normalizes CRLF line endings inside a stripped body", () => {
    const body = "---\r\ndescription: x\r\n---\r\nBody\r\n";
    assert.equal(stripCursorFrontmatter(body), "Body\n");
  });

  test("returns the body unchanged without frontmatter", () => {
    assert.equal(stripCursorFrontmatter("# Scope\n"), "# Scope\n");
  });

  test("returns the body unchanged when the frontmatter block is unterminated", () => {
    const body = "---\ndescription: x\n# Scope\n";
    assert.equal(stripCursorFrontmatter(body), body);
  });
});

describe("workspaceUsesOpencode", () => {
  test("returns false when no opencode files exist", async () => {
    const root = await makeTempRoot("airules-opencode-none-");
    try {
      assert.equal(await workspaceUsesOpencode(root), false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("recognizes AGENTS.md, opencode configs, and a .opencode folder", async () => {
    const root = await makeTempRoot("airules-opencode-evidence-");
    try {
      await writeFile(path.join(root, "AGENTS.md"), "# rules\n");
      assert.equal(await workspaceUsesOpencode(root), true);
      await fs.rm(path.join(root, "AGENTS.md"));

      await writeFile(path.join(root, "opencode.json"), "{}\n");
      assert.equal(await workspaceUsesOpencode(root), true);
      await fs.rm(path.join(root, "opencode.json"));

      await writeFile(path.join(root, "opencode.jsonc"), "{}\n");
      assert.equal(await workspaceUsesOpencode(root), true);
      await fs.rm(path.join(root, "opencode.jsonc"));

      await fs.mkdir(path.join(root, ".opencode"));
      assert.equal(await workspaceUsesOpencode(root), true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveOpencodeConfigPath", () => {
  test("falls back to .opencode/opencode.json when no config exists", async () => {
    const root = await makeTempRoot("airules-opencode-resolve-");
    try {
      assert.equal(
        await resolveOpencodeConfigPath(root),
        path.join(root, ".opencode", "opencode.json")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("prefers an existing root opencode.json", async () => {
    const root = await makeTempRoot("airules-opencode-resolve-");
    try {
      await writeFile(path.join(root, "opencode.json"), "{}\n");
      assert.equal(await resolveOpencodeConfigPath(root), path.join(root, "opencode.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("uses opencode.jsonc when opencode.json is absent", async () => {
    const root = await makeTempRoot("airules-opencode-resolve-");
    try {
      await writeFile(path.join(root, "opencode.jsonc"), "{}\n");
      assert.equal(await resolveOpencodeConfigPath(root), path.join(root, "opencode.jsonc"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("syncBundledMdcsToOpencodeRules", () => {
  test("writes stripped topic rules as <topic>.md without touching .gitignore", async () => {
    const bundle = await makeTempRoot("airules-opencode-bundle-");
    await writeFile(
      path.join(bundle, SAMPLE_RULE),
      "---\ndescription: x\nalwaysApply: true\n---\n\n# Code\n\n- Reuse code.\n"
    );
    const workspace = await makeTempRoot("airules-opencode-sync-");
    try {
      await syncBundledMdcsToOpencodeRules(workspace, bundle, [SAMPLE_RULE], null);

      const mirror = path.join(workspace, ".opencode", "rules", "ai-rules", "code.md");
      assert.equal(
        await fs.readFile(mirror, "utf8"),
        "\n# Code\n\n- Reuse code.\n"
      );
      assert.equal(await pathExists(path.join(workspace, ".gitignore")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("refuses an unsafe rule path before touching disk", async () => {
    const bundle = await makeTempRoot("airules-opencode-unsafe-");
    const workspace = await makeTempRoot("airules-opencode-unsafe-ws-");
    try {
      await assert.rejects(
        () => syncBundledMdcsToOpencodeRules(workspace, bundle, ["../escape.mdc"], null),
        /Refusing unsafe rule path|Bundled rule missing/
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("mirrors disabled Cursor rules as .md.disabled", async () => {
    const bundle = await makeTempRoot("airules-opencode-state-bundle-");
    await writeFile(
      path.join(bundle, SAMPLE_RULE),
      "---\ndescription: x\nalwaysApply: true\n---\n\n# Code\n\n- Reuse code.\n"
    );
    await writeFile(path.join(bundle, "scope.mdc"), "scope stub\n");
    const workspace = await makeTempRoot("airules-opencode-state-ws-");
    try {
      const cursorDir = workspaceRulesDir(workspace);
      await writeFile(path.join(cursorDir, `${SAMPLE_RULE}.disabled`), "off\n");
      await writeFile(path.join(cursorDir, "scope.mdc"), "on\n");
      await syncBundledMdcsToOpencodeRules(workspace, bundle, [SAMPLE_RULE, "scope.mdc"], null);

      const dest = path.join(workspace, ".opencode", "rules", "ai-rules");
      assert.equal(await pathExists(path.join(dest, "code.md")), false);
      assert.equal(
        await fs.readFile(path.join(dest, "code.md.disabled"), "utf8"),
        "\n# Code\n\n- Reuse code.\n"
      );
      assert.equal(await pathExists(path.join(dest, "scope.md")), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("opencode mirror state", () => {
  test("mirrorRuleToOpencode writes active and disabled mirrors from the Cursor file", async () => {
    const workspace = await makeTempRoot("airules-mirror-");
    try {
      const cursorDir = workspaceRulesDir(workspace);
      await writeFile(
        path.join(cursorDir, SAMPLE_RULE),
        "---\ndescription: x\nalwaysApply: true\n---\n\nBody\n"
      );
      const mirror = path.join(workspace, ".opencode", "rules", "ai-rules", "code.md");

      await mirrorRuleToOpencode(workspace, SAMPLE_RULE, true);
      assert.equal(await fs.readFile(mirror, "utf8"), "\nBody\n");
      assert.equal(await pathExists(`${mirror}.disabled`), false);

      await setRuleEnabled(workspaceRulesDir(workspace), SAMPLE_RULE, false);
      await mirrorRuleToOpencode(workspace, SAMPLE_RULE, false);
      assert.equal(await pathExists(mirror), false);
      assert.equal(await fs.readFile(`${mirror}.disabled`, "utf8"), "\nBody\n");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("mirrorRuleToOpencode leaves the mirror untouched when the Cursor source is missing", async () => {
    const workspace = await makeTempRoot("airules-mirror-missing-");
    try {
      await mirrorRuleToOpencode(workspace, SAMPLE_RULE, true);
      const mirror = path.join(workspace, ".opencode", "rules", "ai-rules", "code.md");
      assert.equal(await pathExists(mirror), false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("syncOpencodeMirrorFromWorkspace is a no-op without Cursor rules", async () => {
    const workspace = await makeTempRoot("airules-mirror-nocursor-");
    try {
      await syncOpencodeMirrorFromWorkspace(workspace, [SAMPLE_RULE]);
      assert.equal(
        await pathExists(path.join(workspace, ".opencode", "rules", "ai-rules", "code.md")),
        false
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("syncOpencodeMirrorFromWorkspace mirrors every rule state", async () => {
    const workspace = await makeTempRoot("airules-mirror-bulk-");
    try {
      const cursorDir = workspaceRulesDir(workspace);
      await writeFile(path.join(cursorDir, SAMPLE_RULE), "on\n");
      await writeFile(path.join(cursorDir, "scope.mdc.disabled"), "off\n");
      await syncOpencodeMirrorFromWorkspace(workspace, [SAMPLE_RULE, "scope.mdc"]);

      const dest = path.join(workspace, ".opencode", "rules", "ai-rules");
      assert.equal(await pathExists(path.join(dest, "code.md")), true);
      assert.equal(await pathExists(path.join(dest, "scope.md")), false);
      assert.equal(await pathExists(path.join(dest, "scope.md.disabled")), true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("ensureOpencodeInstructionsEntry", () => {
  test("creates the default config with $schema and instructions", async () => {
    const root = await makeTempRoot("airules-opencode-create-");
    const configPath = path.join(root, ".opencode", "opencode.json");
    try {
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "created-config");
      const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
      assert.equal(parsed.$schema, "https://opencode.ai/config.json");
      assert.deepEqual(parsed.instructions, [OPENCODE_RULES_GLOB]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("adds a top-level instructions member to an existing config", async () => {
    const root = await makeTempRoot("airules-opencode-add-key-");
    const configPath = path.join(root, "opencode.json");
    try {
      await writeFile(configPath, '{\n  "model": "anthropic/claude-sonnet-4-6"\n}\n');
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "updated-config");
      const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
      assert.equal(parsed.model, "anthropic/claude-sonnet-4-6");
      assert.deepEqual(parsed.instructions, [OPENCODE_RULES_GLOB]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("appends the glob to an existing instructions array", async () => {
    const root = await makeTempRoot("airules-opencode-append-");
    const configPath = path.join(root, "opencode.json");
    try {
      await writeFile(configPath, '{\n  "instructions": ["docs/guidelines.md"]\n}\n');
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "updated-config");
      const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
      assert.deepEqual(parsed.instructions, ["docs/guidelines.md", OPENCODE_RULES_GLOB]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("reports unchanged when the glob is already registered", async () => {
    const root = await makeTempRoot("airules-opencode-unchanged-");
    const configPath = path.join(root, "opencode.json");
    const original = `{\n  "instructions": ["${OPENCODE_RULES_GLOB}"]\n}\n`;
    try {
      await writeFile(configPath, original);
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "unchanged");
      assert.equal(await fs.readFile(configPath, "utf8"), original);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("preserves comments and trailing commas in a JSONC config", async () => {
    const root = await makeTempRoot("airules-opencode-jsonc-");
    const configPath = path.join(root, "opencode.jsonc");
    try {
      await writeFile(
        configPath,
        "// opencode project config\n" +
          '{\n  "$schema": "https://opencode.ai/config.json", // keep\n' +
          '  "model": "anthropic/claude-sonnet-4-6",\n}\n'
      );
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "updated-config");
      const updated = await fs.readFile(configPath, "utf8");
      assert.ok(updated.includes("// opencode project config"));
      assert.ok(updated.includes("// keep"));
      const cleaned = updated
        .replace(/^\s*\/\/[^\n]*\n/, "")
        .replace(/,\s*\/\/[^\n]*/g, ",")
        .replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(cleaned);
      assert.equal(parsed.model, "anthropic/claude-sonnet-4-6");
      assert.deepEqual(parsed.instructions, [OPENCODE_RULES_GLOB]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("leaves an empty instructions array valid when inserting", async () => {
    const root = await makeTempRoot("airules-opencode-empty-array-");
    const configPath = path.join(root, "opencode.json");
    try {
      await writeFile(configPath, '{\n  "instructions": []\n}\n');
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "updated-config");
      const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
      assert.deepEqual(parsed.instructions, [OPENCODE_RULES_GLOB]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("returns skipped without touching a malformed config", async () => {
    const root = await makeTempRoot("airules-opencode-bad-");
    const configPath = path.join(root, "opencode.json");
    const original = "{\n  instructions: [\n";
    try {
      await writeFile(configPath, original);
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "skipped");
      assert.equal(await fs.readFile(configPath, "utf8"), original);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("returns skipped when instructions exists but is not an array", async () => {
    const root = await makeTempRoot("airules-opencode-nonarray-");
    const configPath = path.join(root, "opencode.json");
    const original = '{\n  "instructions": "AGENTS.md"\n}\n';
    try {
      await writeFile(configPath, original);
      const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
      assert.equal(result, "skipped");
      assert.equal(await fs.readFile(configPath, "utf8"), original);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("workspaceUsesClaudeCode", () => {
  test("returns false when no Claude Code files exist", async () => {
    const root = await makeTempRoot("airules-claude-none-");
    try {
      assert.equal(await workspaceUsesClaudeCode(root), false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("recognizes CLAUDE.md, CLAUDE.local.md, and a .claude folder", async () => {
    const root = await makeTempRoot("airules-claude-evidence-");
    try {
      await writeFile(path.join(root, "CLAUDE.md"), "# rules\n");
      assert.equal(await workspaceUsesClaudeCode(root), true);
      await fs.rm(path.join(root, "CLAUDE.md"));

      await writeFile(path.join(root, "CLAUDE.local.md"), "# local\n");
      assert.equal(await workspaceUsesClaudeCode(root), true);
      await fs.rm(path.join(root, "CLAUDE.local.md"));

      await fs.mkdir(path.join(root, ".claude"));
      assert.equal(await workspaceUsesClaudeCode(root), true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("convertCursorRuleToClaudeRule", () => {
  test("strips frontmatter for a rule with no globs", () => {
    const body =
      "---\ndescription: x\nalwaysApply: true\n---\n\n# Code\n\n- Reuse code.\n";
    assert.equal(convertCursorRuleToClaudeRule(body), "\n# Code\n\n- Reuse code.\n");
  });

  test("converts a globs pattern into paths: frontmatter", () => {
    const body =
      '---\ndescription: x\nglobs: "**/*.{md,mdx}"\nalwaysApply: false\n---\n\n# Markdown\n\nBody\n';
    assert.equal(
      convertCursorRuleToClaudeRule(body),
      '---\npaths:\n  - "**/*.{md,mdx}"\n---\n\n\n# Markdown\n\nBody\n'
    );
  });

  test("returns the body unchanged without frontmatter", () => {
    assert.equal(convertCursorRuleToClaudeRule("# Scope\n"), "# Scope\n");
  });
});

describe("syncBundledMdcsToClaudeRules", () => {
  test("writes converted topic rules as <topic>.md without touching .gitignore", async () => {
    const bundle = await makeTempRoot("airules-claude-bundle-");
    await writeFile(
      path.join(bundle, SAMPLE_RULE),
      "---\ndescription: x\nalwaysApply: true\n---\n\n# Code\n\n- Reuse code.\n"
    );
    const workspace = await makeTempRoot("airules-claude-sync-");
    try {
      await syncBundledMdcsToClaudeRules(workspace, bundle, [SAMPLE_RULE], null);

      const mirror = path.join(workspace, ".claude", "rules", "ai-rules", "code.md");
      assert.equal(await fs.readFile(mirror, "utf8"), "\n# Code\n\n- Reuse code.\n");
      assert.equal(await pathExists(path.join(workspace, ".gitignore")), false);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("refuses an unsafe rule path before touching disk", async () => {
    const bundle = await makeTempRoot("airules-claude-unsafe-");
    const workspace = await makeTempRoot("airules-claude-unsafe-ws-");
    try {
      await assert.rejects(
        () => syncBundledMdcsToClaudeRules(workspace, bundle, ["../escape.mdc"], null),
        /Refusing unsafe rule path|Bundled rule missing/
      );
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("mirrors disabled Cursor rules as .md.disabled", async () => {
    const bundle = await makeTempRoot("airules-claude-state-bundle-");
    await writeFile(
      path.join(bundle, SAMPLE_RULE),
      "---\ndescription: x\nalwaysApply: true\n---\n\n# Code\n\n- Reuse code.\n"
    );
    await writeFile(path.join(bundle, "scope.mdc"), "scope stub\n");
    const workspace = await makeTempRoot("airules-claude-state-ws-");
    try {
      const cursorDir = workspaceRulesDir(workspace);
      await writeFile(path.join(cursorDir, `${SAMPLE_RULE}.disabled`), "off\n");
      await writeFile(path.join(cursorDir, "scope.mdc"), "on\n");
      await syncBundledMdcsToClaudeRules(workspace, bundle, [SAMPLE_RULE, "scope.mdc"], null);

      const dest = path.join(workspace, ".claude", "rules", "ai-rules");
      assert.equal(await pathExists(path.join(dest, "code.md")), false);
      assert.equal(
        await fs.readFile(path.join(dest, "code.md.disabled"), "utf8"),
        "\n# Code\n\n- Reuse code.\n"
      );
      assert.equal(await pathExists(path.join(dest, "scope.md")), true);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("Claude Code mirror state", () => {
  test("mirrorRuleToClaudeCode writes active and disabled mirrors from the Cursor file", async () => {
    const workspace = await makeTempRoot("airules-claude-mirror-");
    try {
      const cursorDir = workspaceRulesDir(workspace);
      await writeFile(
        path.join(cursorDir, SAMPLE_RULE),
        "---\ndescription: x\nalwaysApply: true\n---\n\nBody\n"
      );
      const mirror = path.join(workspace, ".claude", "rules", "ai-rules", "code.md");

      await mirrorRuleToClaudeCode(workspace, SAMPLE_RULE, true);
      assert.equal(await fs.readFile(mirror, "utf8"), "\nBody\n");
      assert.equal(await pathExists(`${mirror}.disabled`), false);

      await setRuleEnabled(workspaceRulesDir(workspace), SAMPLE_RULE, false);
      await mirrorRuleToClaudeCode(workspace, SAMPLE_RULE, false);
      assert.equal(await pathExists(mirror), false);
      assert.equal(await fs.readFile(`${mirror}.disabled`, "utf8"), "\nBody\n");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("mirrorRuleToClaudeCode leaves the mirror untouched when the Cursor source is missing", async () => {
    const workspace = await makeTempRoot("airules-claude-mirror-missing-");
    try {
      await mirrorRuleToClaudeCode(workspace, SAMPLE_RULE, true);
      const mirror = path.join(workspace, ".claude", "rules", "ai-rules", "code.md");
      assert.equal(await pathExists(mirror), false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("syncClaudeMirrorFromWorkspace is a no-op without Cursor rules", async () => {
    const workspace = await makeTempRoot("airules-claude-mirror-nocursor-");
    try {
      await syncClaudeMirrorFromWorkspace(workspace, [SAMPLE_RULE]);
      assert.equal(
        await pathExists(path.join(workspace, ".claude", "rules", "ai-rules", "code.md")),
        false
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("syncClaudeMirrorFromWorkspace mirrors every rule state", async () => {
    const workspace = await makeTempRoot("airules-claude-mirror-bulk-");
    try {
      const cursorDir = workspaceRulesDir(workspace);
      await writeFile(path.join(cursorDir, SAMPLE_RULE), "on\n");
      await writeFile(path.join(cursorDir, "scope.mdc.disabled"), "off\n");
      await syncClaudeMirrorFromWorkspace(workspace, [SAMPLE_RULE, "scope.mdc"]);

      const dest = path.join(workspace, ".claude", "rules", "ai-rules");
      assert.equal(await pathExists(path.join(dest, "code.md")), true);
      assert.equal(await pathExists(path.join(dest, "scope.md")), false);
      assert.equal(await pathExists(path.join(dest, "scope.md.disabled")), true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("workspaceClaudeRulesDir", () => {
  test("uses the expected suffix", () => {
    const dir = workspaceClaudeRulesDir("/tmp/proj");
    assert.ok(dir.endsWith(path.join(".claude", "rules", "ai-rules")));
  });
});
