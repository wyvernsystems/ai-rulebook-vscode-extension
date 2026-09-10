import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  AGENTS_MD_IMPORT,
  claudeMdImportsAgentsMd,
  claudeMdPath,
  ensureAgentsMdImport,
  removeAgentsMdImport,
} from "../out/claudeMd.js";
import { pathExists } from "../out/rulesOperations.js";

async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "airules-claude-md-"));
  try {
    await run(root, claudeMdPath(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("claudeMdImportsAgentsMd", () => {
  test("recognizes the import on its own line or inline in prose", () => {
    assert.equal(claudeMdImportsAgentsMd("@AGENTS.md\n"), true);
    assert.equal(claudeMdImportsAgentsMd("# Project\n\nSee @AGENTS.md for the rules.\n"), true);
    assert.equal(claudeMdImportsAgentsMd("Rules: @AGENTS.md, then more.\n"), true);
  });

  test("ignores the token inside code fences, inline code, and other paths", () => {
    assert.equal(claudeMdImportsAgentsMd("```\n@AGENTS.md\n```\n"), false);
    assert.equal(claudeMdImportsAgentsMd("~~~md\n@AGENTS.md\n~~~\n"), false);
    assert.equal(claudeMdImportsAgentsMd("Add `@AGENTS.md` to import.\n"), false);
    assert.equal(claudeMdImportsAgentsMd("@docs/AGENTS.md\n"), false);
    assert.equal(claudeMdImportsAgentsMd("@AGENTS.md.bak\n"), false);
    assert.equal(claudeMdImportsAgentsMd(""), false);
  });
});

describe("ensureAgentsMdImport", () => {
  test("creates CLAUDE.md holding just the import", async () => {
    await withRoot(async (root, file) => {
      assert.equal(await ensureAgentsMdImport(root), "created");
      assert.equal(await fs.readFile(file, "utf8"), `${AGENTS_MD_IMPORT}\n`);
    });
  });

  test("appends the import to an existing CLAUDE.md that lacks it", async () => {
    await withRoot(async (root, file) => {
      await fs.writeFile(file, "# Notes\n\nPrefer small PRs.");

      assert.equal(await ensureAgentsMdImport(root), "added");
      assert.equal(
        await fs.readFile(file, "utf8"),
        `# Notes\n\nPrefer small PRs.\n\n${AGENTS_MD_IMPORT}\n`
      );
    });
  });

  test("leaves a CLAUDE.md that already imports AGENTS.md untouched", async () => {
    await withRoot(async (root, file) => {
      const text = "Read @AGENTS.md first.\n";
      await fs.writeFile(file, text);

      assert.equal(await ensureAgentsMdImport(root), "unchanged");
      assert.equal(await fs.readFile(file, "utf8"), text);
    });
  });

  test("still appends when the only mention is inside a code fence", async () => {
    await withRoot(async (root, file) => {
      await fs.writeFile(file, "```\n@AGENTS.md\n```\n");

      assert.equal(await ensureAgentsMdImport(root), "added");
      assert.equal(await fs.readFile(file, "utf8"), "```\n@AGENTS.md\n```\n\n@AGENTS.md\n");
    });
  });
});

describe("removeAgentsMdImport", () => {
  for (const fence of ["```", "~~~~"]) {
    test(`preserves ${fence} fenced examples through install and removal`, async () => {
      await withRoot(async (root, file) => {
        const original = `# Notes\n\n${fence}md\n\n@AGENTS.md\n${fence}\n`;
        await fs.writeFile(file, original);
        await ensureAgentsMdImport(root);
        assert.deepEqual(await removeAgentsMdImport(root), { removed: true, deletedFile: false });
        assert.equal(await fs.readFile(file, "utf8"), original);
        assert.deepEqual(await removeAgentsMdImport(root), { removed: false, deletedFile: false });
        assert.equal(await fs.readFile(file, "utf8"), original);
      });
    });
  }

  test("deletes a CLAUDE.md that held only the import", async () => {
    await withRoot(async (root, file) => {
      await ensureAgentsMdImport(root);

      assert.deepEqual(await removeAgentsMdImport(root), { removed: true, deletedFile: true });
      assert.equal(await pathExists(file), false);
    });
  });

  test("removes only the import line from a CLAUDE.md with other content", async () => {
    await withRoot(async (root, file) => {
      await fs.writeFile(file, "# Notes\n\n@AGENTS.md\n\nPrefer small PRs.\n");

      assert.deepEqual(await removeAgentsMdImport(root), { removed: true, deletedFile: false });
      assert.equal(await fs.readFile(file, "utf8"), "# Notes\n\nPrefer small PRs.\n");
    });
  });

  test("leaves an inline mention alone and reports nothing removed", async () => {
    await withRoot(async (root, file) => {
      const text = "Read @AGENTS.md first.\n";
      await fs.writeFile(file, text);

      assert.deepEqual(await removeAgentsMdImport(root), { removed: false, deletedFile: false });
      assert.equal(await fs.readFile(file, "utf8"), text);
      assert.deepEqual(await removeAgentsMdImport(path.join(root, "nope")), {
        removed: false,
        deletedFile: false,
      });
    });
  });
});
