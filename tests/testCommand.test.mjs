import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  detectTestCommand,
  renderRuleBody,
  TEST_COMMAND_PLACEHOLDER,
  UNKNOWN_TEST_COMMAND_TEXT,
} from "../out/testCommand.js";

async function makeTempRoot(prefix = "airules-testcmd-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(abs, contents) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, "utf8");
}

async function withRoot(files, assertions) {
  const root = await makeTempRoot();
  try {
    for (const [rel, contents] of Object.entries(files)) {
      await writeFile(path.join(root, rel), contents);
    }
    await assertions(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const packageJsonWithTest = JSON.stringify({
  name: "demo",
  scripts: { test: "node --test tests/*.mjs" },
});

describe("detectTestCommand — Node", () => {
  test("uses npm when a test script exists with no lockfile", async () => {
    await withRoot({ "package.json": packageJsonWithTest }, async (root) => {
      assert.equal(await detectTestCommand(root), "npm test");
    });
  });

  test("picks the package manager from the lockfile", async () => {
    const cases = [
      ["pnpm-lock.yaml", "pnpm test"],
      ["yarn.lock", "yarn test"],
      ["bun.lockb", "bun test"],
      ["package-lock.json", "npm test"],
    ];
    for (const [lockfile, expected] of cases) {
      await withRoot(
        { "package.json": packageJsonWithTest, [lockfile]: "" },
        async (root) => {
          assert.equal(await detectTestCommand(root), expected);
        }
      );
    }
  });

  test("ignores the npm default placeholder test script", async () => {
    await withRoot(
      {
        "package.json": JSON.stringify({
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        }),
      },
      async (root) => {
        assert.equal(await detectTestCommand(root), null);
      }
    );
  });

  test("ignores a package.json with no test script", async () => {
    await withRoot({ "package.json": JSON.stringify({ name: "demo" }) }, async (root) => {
      assert.equal(await detectTestCommand(root), null);
    });
  });

  test("ignores an unparseable package.json", async () => {
    await withRoot({ "package.json": "{not json" }, async (root) => {
      assert.equal(await detectTestCommand(root), null);
    });
  });
});

describe("detectTestCommand — other ecosystems", () => {
  test("recognizes Cargo and Go projects", async () => {
    await withRoot({ "Cargo.toml": "[package]\nname = \"demo\"\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), "cargo test");
    });
    await withRoot({ "go.mod": "module demo\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), "go test ./...");
    });
  });

  test("claims pytest only with explicit pytest evidence", async () => {
    await withRoot({ "pytest.ini": "[pytest]\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), "pytest");
    });
    await withRoot(
      { "pyproject.toml": "[tool.pytest.ini_options]\ntestpaths = [\"tests\"]\n" },
      async (root) => {
        assert.equal(await detectTestCommand(root), "pytest");
      }
    );
    await withRoot({ "pyproject.toml": "[project]\nname = \"demo\"\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), null);
    });
  });

  test("recognizes a Makefile test target but not an unrelated target", async () => {
    await withRoot({ Makefile: "build:\n\tcc main.c\n\ntest:\n\t./run\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), "make test");
    });
    await withRoot({ Makefile: "build:\n\tcc main.c\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), null);
    });
  });

  test("prefers the Node test script over a Makefile fallback", async () => {
    await withRoot(
      { "package.json": packageJsonWithTest, Makefile: "test:\n\t./run\n" },
      async (root) => {
        assert.equal(await detectTestCommand(root), "npm test");
      }
    );
  });

  test("returns null for a project with no recognizable test setup", async () => {
    await withRoot({ "README.md": "# demo\n" }, async (root) => {
      assert.equal(await detectTestCommand(root), null);
    });
  });
});

describe("renderRuleBody", () => {
  const body = `Run ${TEST_COMMAND_PLACEHOLDER} after every change to ${TEST_COMMAND_PLACEHOLDER}.\n`;

  test("substitutes a detected command as inline code", () => {
    assert.equal(
      renderRuleBody(body, "npm test"),
      "Run `npm test` after every change to `npm test`.\n"
    );
  });

  test("falls back to prose when no command was detected", () => {
    assert.equal(
      renderRuleBody(body, null),
      `Run ${UNKNOWN_TEST_COMMAND_TEXT} after every change to ${UNKNOWN_TEST_COMMAND_TEXT}.\n`
    );
  });

  test("treats undefined like a missing command", () => {
    assert.ok(!renderRuleBody(body, undefined).includes(TEST_COMMAND_PLACEHOLDER));
  });

  test("leaves a body without placeholders untouched", () => {
    assert.equal(renderRuleBody("# Scope\n", "npm test"), "# Scope\n");
  });
});
