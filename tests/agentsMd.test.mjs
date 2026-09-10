import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  AGENTS_MD_BLOCK_END,
  AGENTS_MD_BLOCK_START,
  agentsMdPath,
  hasRulesBlock,
  installRulesIntoAgentsMd,
  isRuleEnabledInAgentsMd,
  parseAgentsMd,
  removeRulesBlockFromAgentsMd,
  renderRuleForAgentsMd,
  ruleEndMarker,
  ruleId,
  ruleSectionLine,
  ruleStartMarker,
  setAllRulesEnabledInAgentsMd,
  setRuleEnabledInAgentsMd,
} from "../out/agentsMd.js";
import { pathExists } from "../out/rulesOperations.js";
import { UNKNOWN_TEST_COMMAND_TEXT } from "../out/testCommand.js";

const BUNDLE = {
  "code.mdc": "---\ndescription: Code\nalwaysApply: true\n---\n\n# Code\n\n- Reuse helpers.\n",
  "docs.mdc":
    '---\ndescription: Docs\nglobs: "**/*.md"\nalwaysApply: false\n---\n\n# Docs\n\n- Update docs.\n',
  "tests.mdc":
    "---\ndescription: Tests\nalwaysApply: true\n---\n\n# Tests\n\n- Run {{TEST_COMMAND}}.\n",
};
const RULE_FILES = Object.keys(BUNDLE);

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(abs, contents) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, "utf8");
}

async function makeBundle() {
  const dir = await makeTempRoot("airules-agents-bundle-");
  for (const [name, body] of Object.entries(BUNDLE)) {
    await writeFile(path.join(dir, name), body);
  }
  return dir;
}

/** A workspace plus a bundle, cleaned up together. */
async function withFixture(run) {
  const bundle = await makeBundle();
  const root = await makeTempRoot("airules-agents-ws-");
  try {
    await run({ bundle, root, file: agentsMdPath(root) });
  } finally {
    await fs.rm(bundle, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}

function section(id, body) {
  return body === null
    ? `${ruleStartMarker(id, false)}\n${ruleEndMarker(id)}\n`
    : `${ruleStartMarker(id, true)}\n\n${body}\n\n${ruleEndMarker(id)}\n`;
}

describe("ruleId", () => {
  test("drops the .mdc suffix and flattens nested paths", () => {
    assert.equal(ruleId("scope.mdc"), "scope");
    assert.equal(ruleId("nested/my_rule.mdc"), "nested-my_rule");
  });
});

describe("renderRuleForAgentsMd", () => {
  test("strips Cursor frontmatter, renders the test command, and demotes headings", () => {
    assert.equal(
      renderRuleForAgentsMd(BUNDLE["tests.mdc"], "npm test"),
      "## Tests\n\n- Run `npm test`."
    );
    assert.equal(
      renderRuleForAgentsMd(BUNDLE["tests.mdc"], null),
      `## Tests\n\n- Run ${UNKNOWN_TEST_COMMAND_TEXT}.`
    );
  });

  test("demotes every heading level but never past h6, and leaves fenced code alone", () => {
    const body = "# One\n\n###### Six\n\n```md\n# not a heading\n```\n\ntext\n";
    assert.equal(
      renderRuleForAgentsMd(body, null),
      "## One\n\n###### Six\n\n```md\n# not a heading\n```\n\ntext"
    );
  });

  test("keeps a body with no frontmatter as-is apart from demotion", () => {
    assert.equal(renderRuleForAgentsMd("# Scope\n\n- x\n", null), "## Scope\n\n- x");
  });
});

describe("installRulesIntoAgentsMd", () => {
  test("creates AGENTS.md with a title and one enabled section per rule", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      const result = await installRulesIntoAgentsMd(root, bundle, RULE_FILES, "npm test");

      assert.deepEqual(result, { created: true });
      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith("# AGENTS.md\n\n" + AGENTS_MD_BLOCK_START + "\n"), text);
      assert.ok(text.endsWith("\n" + AGENTS_MD_BLOCK_END + "\n"), text);
      assert.ok(text.includes(section("code", "## Code\n\n- Reuse helpers.")), text);
      assert.ok(text.includes(section("docs", "## Docs\n\n- Update docs.")), text);
      assert.ok(text.includes(section("tests", "## Tests\n\n- Run `npm test`.")), text);
      assert.ok(!text.includes("---\ndescription"), "frontmatter must not leak into AGENTS.md");
      assert.ok(!text.includes("{{TEST_COMMAND}}"));
      assert.equal(
        text.indexOf(ruleStartMarker("code", true)) < text.indexOf(ruleStartMarker("docs", true)),
        true,
        "sections follow manifest order"
      );
      for (const ruleFile of RULE_FILES) {
        assert.equal(await isRuleEnabledInAgentsMd(root, ruleFile), true);
      }
    });
  });

  test("appends the block to an existing AGENTS.md without touching its content", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      const existing = "# My project\n\nRun `make build` first.";
      await writeFile(file, existing);

      const result = await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);

      assert.deepEqual(result, { created: false });
      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith(existing + "\n\n" + AGENTS_MD_BLOCK_START + "\n"), text);
      assert.ok(!text.includes("# AGENTS.md"), "no extra title on an existing file");
      assert.equal(text.split(AGENTS_MD_BLOCK_START).length, 2);
    });
  });

  test("replaces an existing block in place, preserving text before and after it", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, "npm test");
      const installed = await fs.readFile(file, "utf8");
      await writeFile(file, "# Intro\n\nbefore\n\n" + installed.slice("# AGENTS.md\n\n".length) + "\nafter\n");

      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, "pnpm test");

      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith("# Intro\n\nbefore\n\n" + AGENTS_MD_BLOCK_START + "\n"), text);
      assert.ok(text.endsWith(AGENTS_MD_BLOCK_END + "\n\nafter\n"), text);
      assert.equal(text.split(AGENTS_MD_BLOCK_START).length, 2, "exactly one block");
      assert.ok(text.includes("- Run `pnpm test`."), "rule text refreshed from the bundle");
      assert.ok(!text.includes("- Run `npm test`."));
    });
  });

  test("keeps a disabled rule disabled on reinstall and adds rules missing from the block", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, ["code.mdc", "tests.mdc"], null);
      await setRuleEnabledInAgentsMd(root, bundle, "code.mdc", false, null);

      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);

      const text = await fs.readFile(file, "utf8");
      assert.equal(await isRuleEnabledInAgentsMd(root, "code.mdc"), false);
      assert.equal(await isRuleEnabledInAgentsMd(root, "docs.mdc"), true);
      assert.equal(await isRuleEnabledInAgentsMd(root, "tests.mdc"), true);
      assert.ok(text.includes(section("code", null)), text);
      assert.ok(!text.includes("- Reuse helpers."), "a disabled rule's text stays out of the file");
    });
  });

  test("enableAll re-enables every rule and drops sections for rules no longer bundled", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      await setRuleEnabledInAgentsMd(root, bundle, "code.mdc", false, null);

      await installRulesIntoAgentsMd(root, bundle, ["code.mdc", "docs.mdc"], null, {
        enableAll: true,
      });

      const text = await fs.readFile(file, "utf8");
      assert.equal(await isRuleEnabledInAgentsMd(root, "code.mdc"), true);
      assert.ok(!text.includes(ruleStartMarker("tests", true)), "stale section removed");
      assert.ok(!text.includes("## Tests"));
    });
  });

  test("refuses unsafe rule paths and reports a missing bundled rule", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await assert.rejects(
        installRulesIntoAgentsMd(root, bundle, ["../escape.mdc"], null),
        /Refusing unsafe rule path/
      );
      await assert.rejects(
        installRulesIntoAgentsMd(root, bundle, ["missing.mdc"], null),
        /Bundled rule missing: missing\.mdc/
      );
      assert.equal(await pathExists(file), false, "nothing written after a rejected install");
    });
  });

  test("reports a damaged block instead of rewriting the file", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      const damaged = "# Title\n\n" + AGENTS_MD_BLOCK_START + "\n\nno end marker\n";
      await writeFile(file, damaged);

      await assert.rejects(
        installRulesIntoAgentsMd(root, bundle, RULE_FILES, null),
        /AGENTS\.md.*ai-rulebook:end/
      );
      assert.equal(await fs.readFile(file, "utf8"), damaged);
    });
  });
});

describe("parseAgentsMd", () => {
  test("returns null when the file has no managed block", () => {
    assert.equal(parseAgentsMd("# Just a project\n"), null);
    assert.equal(parseAgentsMd(""), null);
  });

  test("splits the text around the block and reads every section's state and body", () => {
    const text =
      "intro\n\n" +
      AGENTS_MD_BLOCK_START +
      "\n<!-- note -->\n\n" +
      section("code", "## Code\n\n- Reuse helpers.") +
      "\n" +
      section("docs", null) +
      "\n" +
      AGENTS_MD_BLOCK_END +
      "\n\noutro\n";

    assert.deepEqual(parseAgentsMd(text), {
      before: "intro\n\n",
      after: "\noutro\n",
      rules: [
        { id: "code", enabled: true, body: "## Code\n\n- Reuse helpers." },
        { id: "docs", enabled: false, body: "" },
      ],
    });
  });

  test("accepts CRLF line endings", () => {
    const text = ("a\n" + AGENTS_MD_BLOCK_START + "\n" + section("code", "## Code") + AGENTS_MD_BLOCK_END + "\n").replaceAll("\n", "\r\n");
    const parsed = parseAgentsMd(text);
    assert.equal(parsed.rules.length, 1);
    assert.equal(parsed.rules[0].id, "code");
    assert.equal(parsed.rules[0].enabled, true);
  });

  test("rejects a start marker without an end marker, and the reverse", () => {
    assert.throws(() => parseAgentsMd(AGENTS_MD_BLOCK_START + "\nx\n"), /ai-rulebook:end/);
    assert.throws(() => parseAgentsMd("x\n" + AGENTS_MD_BLOCK_END + "\n"), /ai-rulebook:start/);
  });

  test("rejects a second block, an unterminated section, and a duplicate section", () => {
    const one = section("code", "## Code");
    assert.throws(
      () =>
        parseAgentsMd(
          [AGENTS_MD_BLOCK_START, one, AGENTS_MD_BLOCK_END, AGENTS_MD_BLOCK_START, AGENTS_MD_BLOCK_END, ""].join("\n")
        ),
      /more than one/
    );
    assert.throws(
      () =>
        parseAgentsMd(
          [AGENTS_MD_BLOCK_START, ruleStartMarker("code", true), "body", AGENTS_MD_BLOCK_END, ""].join("\n")
        ),
      /end-rule code/
    );
    assert.throws(
      () => parseAgentsMd([AGENTS_MD_BLOCK_START, one + one, AGENTS_MD_BLOCK_END, ""].join("\n")),
      /twice/
    );
  });
});

describe("rule state in AGENTS.md", () => {
  test("hasRulesBlock and isRuleEnabledInAgentsMd are false without a file or block", async () => {
    await withFixture(async ({ root, file }) => {
      assert.equal(await hasRulesBlock(root), false);
      assert.equal(await isRuleEnabledInAgentsMd(root, "code.mdc"), false);

      await writeFile(file, "# Project\n");
      assert.equal(await hasRulesBlock(root), false);
      assert.equal(await isRuleEnabledInAgentsMd(root, "code.mdc"), false);
    });
  });

  test("a rule absent from an installed block reads as disabled", async () => {
    await withFixture(async ({ bundle, root }) => {
      await installRulesIntoAgentsMd(root, bundle, ["code.mdc"], null);

      assert.equal(await hasRulesBlock(root), true);
      assert.equal(await isRuleEnabledInAgentsMd(root, "docs.mdc"), false);
    });
  });

  test("isRuleEnabledInAgentsMd rejects unsafe rule paths", async () => {
    await withFixture(async ({ root }) => {
      await assert.rejects(isRuleEnabledInAgentsMd(root, "../x.mdc"), /Refusing unsafe rule path/);
    });
  });
});

describe("setRuleEnabledInAgentsMd", () => {
  test("disabling removes only that rule's text and marks its section disabled", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, "npm test");
      await writeFile(file, "# Mine\n\nkeep me\n\n" + (await fs.readFile(file, "utf8")).slice("# AGENTS.md\n\n".length) + "\ntrailer\n");

      await setRuleEnabledInAgentsMd(root, bundle, "docs.mdc", false, "npm test");

      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith("# Mine\n\nkeep me\n\n" + AGENTS_MD_BLOCK_START + "\n"), text);
      assert.ok(text.endsWith(AGENTS_MD_BLOCK_END + "\n\ntrailer\n"), text);
      assert.ok(text.includes(section("docs", null)), text);
      assert.ok(!text.includes("- Update docs."));
      assert.ok(text.includes(section("code", "## Code\n\n- Reuse helpers.")));
      assert.ok(text.includes(section("tests", "## Tests\n\n- Run `npm test`.")));
      assert.equal(await isRuleEnabledInAgentsMd(root, "docs.mdc"), false);
      assert.equal(await isRuleEnabledInAgentsMd(root, "code.mdc"), true);
    });
  });

  test("enabling restores the rule text from the bundle with the current test command", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, "npm test");
      await setRuleEnabledInAgentsMd(root, bundle, "tests.mdc", false, "npm test");

      await setRuleEnabledInAgentsMd(root, bundle, "tests.mdc", true, "cargo test");

      const text = await fs.readFile(file, "utf8");
      assert.ok(text.includes(section("tests", "## Tests\n\n- Run `cargo test`.")), text);
      assert.equal(await isRuleEnabledInAgentsMd(root, "tests.mdc"), true);
    });
  });

  test("is idempotent and keeps section order", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      const before = await fs.readFile(file, "utf8");

      await setRuleEnabledInAgentsMd(root, bundle, "code.mdc", true, null);
      assert.equal(await fs.readFile(file, "utf8"), before);

      await setRuleEnabledInAgentsMd(root, bundle, "code.mdc", false, null);
      await setRuleEnabledInAgentsMd(root, bundle, "code.mdc", true, null);
      assert.equal(await fs.readFile(file, "utf8"), before);
    });
  });

  test("adds a section for a rule the block does not list yet", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, ["code.mdc"], null);

      await setRuleEnabledInAgentsMd(root, bundle, "docs.mdc", true, null);

      const text = await fs.readFile(file, "utf8");
      assert.ok(text.includes(section("docs", "## Docs\n\n- Update docs.")), text);
      assert.ok(
        text.indexOf(ruleEndMarker("code")) < text.indexOf(ruleStartMarker("docs", true)),
        "new sections go after the existing ones"
      );
    });
  });

  test("fails clearly when the rule pack is not installed", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await assert.rejects(
        setRuleEnabledInAgentsMd(root, bundle, "code.mdc", false, null),
        /not installed/
      );
      await writeFile(file, "# Project\n");
      await assert.rejects(
        setRuleEnabledInAgentsMd(root, bundle, "code.mdc", false, null),
        /not installed/
      );
      assert.equal(await fs.readFile(file, "utf8"), "# Project\n");
    });
  });

  test("setAllRulesEnabledInAgentsMd flips every rule at once", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);

      await setAllRulesEnabledInAgentsMd(root, bundle, RULE_FILES, false, null);
      for (const ruleFile of RULE_FILES) {
        assert.equal(await isRuleEnabledInAgentsMd(root, ruleFile), false, ruleFile);
      }
      const off = await fs.readFile(file, "utf8");
      assert.ok(!off.includes("## Code") && !off.includes("## Docs") && !off.includes("## Tests"), off);

      await setAllRulesEnabledInAgentsMd(root, bundle, RULE_FILES, true, "npm test");
      for (const ruleFile of RULE_FILES) {
        assert.equal(await isRuleEnabledInAgentsMd(root, ruleFile), true, ruleFile);
      }
      assert.ok((await fs.readFile(file, "utf8")).includes("- Run `npm test`."));
    });
  });
});

describe("concurrent AGENTS.md changes", () => {
  test("keeps every concurrent toggle and preserves surrounding user text", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await writeFile(file, "# Project\n\nKeep this.\n");
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      await Promise.all(RULE_FILES.map((ruleFile) =>
        setRuleEnabledInAgentsMd(root, bundle, ruleFile, false, null)
      ));
      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith("# Project\n\nKeep this.\n"));
      assert.deepEqual(parseAgentsMd(text).rules.map(({ id, enabled, body }) =>
        ({ id, enabled, body })
      ), RULE_FILES.map((ruleFile) => ({ id: ruleId(ruleFile), enabled: false, body: "" })));
    });
  });

  test("applies install, toggle, and refresh in invocation order", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await Promise.all([
        installRulesIntoAgentsMd(root, bundle, RULE_FILES, null),
        setRuleEnabledInAgentsMd(root, bundle, "code.mdc", false, null),
        installRulesIntoAgentsMd(root, bundle, RULE_FILES, "npm test"),
      ]);
      const rules = parseAgentsMd(await fs.readFile(file, "utf8")).rules;
      assert.equal(rules.find((rule) => rule.id === "code").enabled, false);
      assert.ok(rules.find((rule) => rule.id === "tests").body.includes("`npm test`"));
    });
  });

  test("removal waits for an earlier install", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      const [, removed] = await Promise.all([
        installRulesIntoAgentsMd(root, bundle, RULE_FILES, null),
        removeRulesBlockFromAgentsMd(root),
      ]);
      assert.deepEqual(removed, { removed: true, deletedFile: true });
      assert.equal(await pathExists(file), false);
    });
  });

  test("reports a failed mutation and still runs the next queued mutation", async () => {
    await withFixture(async ({ bundle, root }) => {
      const results = await Promise.allSettled([
        installRulesIntoAgentsMd(root, bundle, ["missing.mdc"], null),
        installRulesIntoAgentsMd(root, bundle, RULE_FILES, null),
        setAllRulesEnabledInAgentsMd(root, bundle, RULE_FILES, false, null),
      ]);
      assert.equal(results[0].status, "rejected");
      assert.match(results[0].reason.message, /Bundled rule missing/);
      assert.equal(results[1].status, "fulfilled");
      assert.equal(results[2].status, "fulfilled");
      for (const ruleFile of RULE_FILES) {
        assert.equal(await isRuleEnabledInAgentsMd(root, ruleFile), false);
      }
    });
  });
});

describe("removeRulesBlockFromAgentsMd", () => {
  test("deletes a file the extension created", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);

      assert.deepEqual(await removeRulesBlockFromAgentsMd(root), {
        removed: true,
        deletedFile: true,
      });
      assert.equal(await pathExists(file), false);
    });
  });

  test("keeps the user's own content and drops only the block", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await writeFile(file, "# Project\n\nUse tabs.\n");
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      await writeFile(file, (await fs.readFile(file, "utf8")) + "\n## Later\n\nmore\n");

      assert.deepEqual(await removeRulesBlockFromAgentsMd(root), {
        removed: true,
        deletedFile: false,
      });
      assert.equal(await fs.readFile(file, "utf8"), "# Project\n\nUse tabs.\n\n## Later\n\nmore\n");
    });
  });

  test("is a no-op without a file or a block", async () => {
    await withFixture(async ({ root, file }) => {
      assert.deepEqual(await removeRulesBlockFromAgentsMd(root), {
        removed: false,
        deletedFile: false,
      });
      await writeFile(file, "# Project\n");
      assert.deepEqual(await removeRulesBlockFromAgentsMd(root), {
        removed: false,
        deletedFile: false,
      });
      assert.equal(await fs.readFile(file, "utf8"), "# Project\n");
    });
  });
});

describe("ruleSectionLine", () => {
  test("returns the zero-based line of the rule's start marker, or null", async () => {
    await withFixture(async ({ bundle, root, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      const text = await fs.readFile(file, "utf8");
      const lines = text.split("\n");

      const line = ruleSectionLine(text, "docs.mdc");
      assert.equal(lines[line], ruleStartMarker("docs", true));
      assert.equal(ruleSectionLine(text, "missing.mdc"), null);
      assert.equal(ruleSectionLine("# nothing\n", "docs.mdc"), null);
    });
  });
});

describe("rule file error handling", () => {
  test("rejects reversed and mismatched markers", () => {
    assert.throws(() => parseAgentsMd(`${AGENTS_MD_BLOCK_END}\n${AGENTS_MD_BLOCK_START}\n`), /before/);
    for (const body of [
      ruleEndMarker("code"),
      `${ruleStartMarker("code", true)}\n${ruleEndMarker("docs")}`,
      `${ruleStartMarker("code", true)}\n${ruleStartMarker("docs", true)}`,
    ]) {
      assert.throws(() => parseAgentsMd(`${AGENTS_MD_BLOCK_START}\n${body}\n${AGENTS_MD_BLOCK_END}\n`), /marker/);
    }
  });

  test("reports an unreadable AGENTS.md without changing it", async () => {
    await withFixture(async ({ root, file }) => {
      await fs.mkdir(file);
      await assert.rejects(hasRulesBlock(root), /Failed to read AGENTS\.md/);
      assert.equal((await fs.stat(file)).isDirectory(), true);
    });
  });

  test("reports a write failure when the workspace disappears", async () => {
    await withFixture(async ({ root, bundle }) => {
      await fs.rmdir(root);
      await assert.rejects(installRulesIntoAgentsMd(root, bundle, RULE_FILES, null), /Failed to write AGENTS\.md/);
    });
  });

  test("reads every bundled rule before overwriting installed rules", async () => {
    await withFixture(async ({ root, bundle, file }) => {
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      const original = await fs.readFile(file, "utf8");
      await fs.unlink(path.join(bundle, "tests.mdc"));
      await fs.mkdir(path.join(bundle, "tests.mdc"));
      await assert.rejects(installRulesIntoAgentsMd(root, bundle, RULE_FILES, null), /Failed to read bundled rule tests\.mdc/);
      assert.equal(await fs.readFile(file, "utf8"), original);
    });
  });

  test("installs into an empty file without adding a title", async () => {
    await withFixture(async ({ root, bundle, file }) => {
      await fs.writeFile(file, " \n\t");
      await installRulesIntoAgentsMd(root, bundle, RULE_FILES, null);
      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith(AGENTS_MD_BLOCK_START));
      assert.equal(parseAgentsMd(text).rules.length, RULE_FILES.length);
    });
  });
});
