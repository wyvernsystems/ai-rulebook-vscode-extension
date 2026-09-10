import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  pathExists,
  removeClaudeRules,
  removeClineRules,
  removeCopilotRules,
  removeCursorRules,
  removeLegacyRuleFolders,
  removeOpencodeRules,
  removeWindsurfRules,
  stripCursorFrontmatter,
  workspaceShowsAgentEvidence,
} from "../out/rulesOperations.js";

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(abs, contents = "stub\n") {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

const LEGACY_FOLDERS = [
  [".cursor", "rules", "ai-rules"],
  [".clinerules", "ai-rules"],
  [".opencode", "rules", "ai-rules"],
  [".claude", "rules", "ai-rules"],
  [".windsurf", "rules", "ai-rules"],
  [".github", "instructions", "ai-rules"],
];

describe("pathExists", () => {
  test("reports filesystem errors instead of treating them as missing paths", async () => {
    await assert.rejects(pathExists("invalid\0path"), /Failed to check path/);
  });

  test("distinguishes present vs missing", async () => {
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

describe("workspaceShowsAgentEvidence", () => {
  test("is false for a workspace with no agent files", async () => {
    const root = await makeTempRoot("airules-evidence-none-");
    try {
      await writeFile(path.join(root, "README.md"), "# hi\n");
      assert.equal(await workspaceShowsAgentEvidence(root), false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("recognizes every supported tool's files and folders", async () => {
    const evidence = [
      ["AGENTS.md", "file"],
      ["CLAUDE.md", "file"],
      ["CLAUDE.local.md", "file"],
      [".claude", "dir"],
      [".cursor", "dir"],
      [".cursorrules", "file"],
      [".clinerules", "dir"],
      [".opencode", "dir"],
      ["opencode.json", "file"],
      ["opencode.jsonc", "file"],
      [".windsurf", "dir"],
      [".windsurfrules", "file"],
      [path.join(".github", "copilot-instructions.md"), "file"],
      [path.join(".github", "instructions"), "dir"],
    ];
    for (const [rel, kind] of evidence) {
      const root = await makeTempRoot("airules-evidence-");
      try {
        if (kind === "dir") {
          await fs.mkdir(path.join(root, rel), { recursive: true });
        } else {
          await writeFile(path.join(root, rel));
        }
        assert.equal(await workspaceShowsAgentEvidence(root), true, rel);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });
});

describe("legacy per-tool rule folders", () => {
  test("removeCursorRules deletes only the Cursor rules folder", async () => {
    const workspace = await makeTempRoot("airules-remove-cursor-");
    try {
      await writeFile(path.join(workspace, ".cursor", "rules", "ai-rules", "code.mdc"), "on\n");
      await writeFile(path.join(workspace, ".clinerules", "ai-rules", "ai-rules-code.md"), "cline\n");

      assert.equal(await removeCursorRules(workspace), true);
      assert.equal(await pathExists(path.join(workspace, ".cursor", "rules", "ai-rules")), false);
      assert.equal(
        await pathExists(path.join(workspace, ".clinerules", "ai-rules", "ai-rules-code.md")),
        true
      );
      assert.equal(await removeCursorRules(workspace), false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("removeLegacyRuleFolders deletes every folder that exists plus the opencode command file", async () => {
    const workspace = await makeTempRoot("airules-remove-all-");
    try {
      for (const segments of LEGACY_FOLDERS) {
        await writeFile(path.join(workspace, ...segments, "code.md"), "x\n");
      }
      await writeFile(path.join(workspace, ".opencode", "command", "ai-rulebook.md"), "cmd\n");
      await writeFile(path.join(workspace, "AGENTS.md"), "# keep\n");

      const result = await removeLegacyRuleFolders(workspace);
      assert.deepEqual(result, {
        cursor: true,
        cline: true,
        opencode: true,
        claude: true,
        windsurf: true,
        copilot: true,
      });
      for (const segments of LEGACY_FOLDERS) {
        assert.equal(await pathExists(path.join(workspace, ...segments)), false, segments.join("/"));
      }
      assert.equal(
        await pathExists(path.join(workspace, ".opencode", "command", "ai-rulebook.md")),
        false
      );
      assert.equal(await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8"), "# keep\n");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("individual remove helpers no-op when the folder is absent", async () => {
    const workspace = await makeTempRoot("airules-remove-missing-");
    try {
      assert.equal(await removeCursorRules(workspace), false);
      assert.equal(await removeClineRules(workspace), false);
      assert.equal(await removeOpencodeRules(workspace), false);
      assert.equal(await removeClaudeRules(workspace), false);
      assert.equal(await removeWindsurfRules(workspace), false);
      assert.equal(await removeCopilotRules(workspace), false);
      assert.deepEqual(await removeLegacyRuleFolders(workspace), {
        cursor: false,
        cline: false,
        opencode: false,
        claude: false,
        windsurf: false,
        copilot: false,
      });
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
