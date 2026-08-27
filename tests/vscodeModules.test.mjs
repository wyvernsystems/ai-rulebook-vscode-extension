import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import Module from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import test, { beforeEach, describe } from "node:test";
import { fileURLToPath } from "node:url";

import {
  resetVscodeMock,
  state,
  TreeItemCheckboxState,
  Uri,
  vscode,
  workspace,
} from "./helpers/vscodeMock.mjs";

const originalModuleLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const cursor = await import("../out/cursor.js");
const cline = await import("../out/cline.js");
const claude = await import("../out/claude.js");
const explorerDecorations = await import("../out/explorerDecorations.js");
const opencode = await import("../out/opencode.js");
const ruleStatusUi = await import("../out/ruleStatusUi.js");
const sidebarTreeView = await import("../out/sidebarTreeView.js");
const rulesOperations = await import("../out/rulesOperations.js");
const extension = await import("../out/extension.js");

Module._load = originalModuleLoad;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULE_FILES = [
  "code.mdc",
  "docs.mdc",
  "git.mdc",
  "markdown.mdc",
  "scope.mdc",
  "tests.mdc",
];
const SAMPLE_RULE = RULE_FILES[0];

beforeEach(() => {
  resetVscodeMock();
});

async function makeTempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "airules-vscode-"));
}

async function writeFile(filePath, contents = "stub\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

function makeExtensionContext(extensionPath) {
  const values = new Map();
  return {
    context: {
      extensionPath,
      extension: { packageJSON: { version: "1.4.0" } },
      globalState: {
        get: (key) => values.get(key),
        update: async (key, value) => {
          values.set(key, value);
        },
      },
      subscriptions: [],
    },
    values,
  };
}

describe("Cursor host policy", () => {
  test("isCursorHost returns true when the URI scheme is cursor", () => {
    vscode.env.uriScheme = "cursor";

    assert.equal(cursor.isCursorHost(), true);
  });

  test("isCursorHost matches Cursor in the application name case-insensitively", () => {
    vscode.env.appName = "CURSOR - Insiders";

    assert.equal(cursor.isCursorHost(), true);
  });

  test("isCursorHost returns false for a non-Cursor host", () => {
    assert.equal(cursor.isCursorHost(), false);
  });

  test("readCursorInstallPolicy returns each supported configured policy", () => {
    for (const policy of ["auto", "always", "never"]) {
      state.configuration.set("aiRules.installCursorRulesFolder", policy);
      assert.equal(cursor.readCursorInstallPolicy(), policy);
    }
  });

  test("readCursorInstallPolicy falls back to auto for invalid values", () => {
    for (const invalid of ["sometimes", "", 42, null]) {
      state.configuration.set("aiRules.installCursorRulesFolder", invalid);
      assert.equal(cursor.readCursorInstallPolicy(), "auto");
    }
  });

  test("shouldAutoInstallCursorRules honors always and never regardless of host", () => {
    vscode.env.uriScheme = "cursor";
    state.configuration.set("aiRules.installCursorRulesFolder", "never");
    assert.equal(cursor.shouldAutoInstallCursorRules(), false);

    vscode.env.uriScheme = "vscode";
    state.configuration.set("aiRules.installCursorRulesFolder", "always");
    assert.equal(cursor.shouldAutoInstallCursorRules(), true);
  });

  test("shouldAutoInstallCursorRules uses host detection for auto", () => {
    state.configuration.set("aiRules.installCursorRulesFolder", "auto");
    assert.equal(cursor.shouldAutoInstallCursorRules(), false);

    vscode.env.appName = "Cursor";
    assert.equal(cursor.shouldAutoInstallCursorRules(), true);
  });
});

describe("Cline detection", () => {
  test("isClineInstalled returns false when neither extension is installed", () => {
    assert.equal(cline.isClineInstalled(), false);
  });

  test("isClineInstalled recognizes the stable extension", () => {
    state.installedExtensions.add("saoudrizwan.claude-dev");

    assert.equal(cline.isClineInstalled(), true);
  });

  test("isClineInstalled recognizes the nightly extension", () => {
    state.installedExtensions.add("saoudrizwan.cline-nightly");

    assert.equal(cline.isClineInstalled(), true);
  });
});

describe("opencode detection and sync", () => {
  const bundleDir = path.join(repoRoot, "bundled", "ai-rules");

  test("shouldAutoSyncOpencode honors the setting and workspace evidence", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    assert.equal(await opencode.shouldAutoSyncOpencode(root), false);

    await writeFile(path.join(root, "AGENTS.md"), "# rules\n");
    assert.equal(await opencode.shouldAutoSyncOpencode(root), true);

    state.configuration.set("aiRules.autoSyncOpencodeWhenInstalled", false);
    assert.equal(await opencode.shouldAutoSyncOpencode(root), false);
  });

  test("syncRulePackToOpencode writes stripped rules and creates the config", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    const result = await opencode.syncRulePackToOpencode(root, bundleDir, RULE_FILES);

    assert.equal(result, "created-config");
    const mirror = path.join(root, ".opencode", "rules", "ai-rules", "code.md");
    const body = await fs.readFile(mirror, "utf8");
    assert.ok(body.length > 0);
    assert.ok(!body.startsWith("---"));
    const config = JSON.parse(
      await fs.readFile(path.join(root, ".opencode", "opencode.json"), "utf8")
    );
    assert.deepEqual(config.instructions, [".opencode/rules/ai-rules/*.md"]);
    assert.equal(await rulesOperations.pathExists(path.join(root, ".gitignore")), false);
  });

  test("activate mirrors to opencode on a non-Cursor host with workspace evidence", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "# rules\n");
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(
      await rulesOperations.pathExists(rulesOperations.workspaceRulesDir(workspaceRoot)),
      false
    );
    assert.equal(
      await rulesOperations.pathExists(
        path.join(workspaceRoot, ".opencode", "rules", "ai-rules", "code.md")
      ),
      true
    );
    const config = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, ".opencode", "opencode.json"), "utf8")
    );
    assert.deepEqual(config.instructions, [".opencode/rules/ai-rules/*.md"]);
  });

  test("syncOpencodeWorkspace warns when the opencode config cannot be parsed", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    await writeFile(path.join(workspaceRoot, "opencode.json"), "{\n  instructions: [\n");
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);

    await state.registeredCommands.get("aiRules.syncOpencodeWorkspace")();

    assert.equal(
      await rulesOperations.pathExists(
        path.join(workspaceRoot, ".opencode", "rules", "ai-rules", "code.md")
      ),
      true
    );
    assert.ok(
      state.warnings.some((message) => /add "instructions"/i.test(message)),
      `expected a manual-instructions warning, got: ${state.warnings.join(" | ")}`
    );
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, "opencode.json"), "utf8"),
      "{\n  instructions: [\n"
    );
  });
});

describe("Claude Code detection and sync", () => {
  const bundleDir = path.join(repoRoot, "bundled", "ai-rules");

  test("shouldAutoSyncClaude honors the setting and workspace evidence", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    assert.equal(await claude.shouldAutoSyncClaude(root), false);

    await writeFile(path.join(root, "CLAUDE.md"), "# rules\n");
    assert.equal(await claude.shouldAutoSyncClaude(root), true);

    state.configuration.set("aiRules.autoSyncClaudeWhenInstalled", false);
    assert.equal(await claude.shouldAutoSyncClaude(root), false);
  });

  test("syncRulePackToClaude writes converted rules with no config file", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    await claude.syncRulePackToClaude(root, bundleDir, RULE_FILES);

    const mirror = path.join(root, ".claude", "rules", "ai-rules", "code.md");
    const body = await fs.readFile(mirror, "utf8");
    assert.ok(body.length > 0);
    assert.ok(!body.startsWith("---"));
    assert.equal(await rulesOperations.pathExists(path.join(root, ".gitignore")), false);
  });

  test("activate mirrors to Claude Code on a non-Cursor host with workspace evidence", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# rules\n");
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(
      await rulesOperations.pathExists(rulesOperations.workspaceRulesDir(workspaceRoot)),
      false
    );
    assert.equal(
      await rulesOperations.pathExists(
        path.join(workspaceRoot, ".claude", "rules", "ai-rules", "code.md")
      ),
      true
    );
  });
});

describe("WorkspaceRuleFileColorer", () => {
  test("provideFileDecoration returns active styling for a workspace .mdc rule", () => {
    state.workspaceFolderResolver = () => ({ name: "workspace" });
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const uri = Uri.file(
      path.join("/workspace", ".cursor", "rules", "ai-rules", "core.mdc")
    );

    const decoration = colorer.provideFileDecoration(uri);

    assert.equal(decoration.color.id, "aiRulebook.activeForeground");
    assert.match(decoration.tooltip, /enabled/);
  });

  test("provideFileDecoration returns disabled styling for an .mdc.disabled rule", () => {
    state.workspaceFolderResolver = () => ({ name: "workspace" });
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const uri = Uri.file(
      path.join(
        "/workspace",
        ".cursor",
        "rules",
        "ai-rules",
        "core.mdc.disabled"
      )
    );

    const decoration = colorer.provideFileDecoration(uri);

    assert.equal(decoration.color.id, "aiRulebook.inactiveForeground");
    assert.match(decoration.tooltip, /disabled/);
  });

  test("provideFileDecoration is disabled by the user setting", () => {
    state.configuration.set("aiRules.colorRulesInExplorer", false);
    state.workspaceFolderResolver = () => ({ name: "workspace" });
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const uri = Uri.file(
      path.join("/workspace", ".cursor", "rules", "ai-rules", "core.mdc")
    );

    assert.equal(colorer.provideFileDecoration(uri), undefined);
  });

  test("provideFileDecoration ignores non-file, out-of-workspace, and unrelated files", () => {
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const rulePath = path.join(
      "/workspace",
      ".cursor",
      "rules",
      "ai-rules",
      "core.mdc"
    );
    assert.equal(
      colorer.provideFileDecoration(new Uri({ scheme: "untitled", fsPath: rulePath })),
      undefined
    );
    assert.equal(colorer.provideFileDecoration(Uri.file(rulePath)), undefined);

    state.workspaceFolderResolver = () => ({ name: "workspace" });
    assert.equal(
      colorer.provideFileDecoration(Uri.file(path.join("/workspace", "src", "clean.mdc"))),
      undefined
    );
    assert.equal(
      colorer.provideFileDecoration(
        Uri.file(path.join("/workspace", ".cursor", "rules", "ai-rules", "README.md"))
      ),
      undefined
    );
  });

  test("refresh emits specific URIs or undefined for a full refresh", () => {
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const emitted = [];
    colorer.onDidChangeFileDecorations((value) => emitted.push(value));
    const uri = Uri.file("/workspace/rule.mdc");

    colorer.refresh([uri]);
    colorer.refresh();

    assert.deepEqual(emitted, [[uri], undefined]);
  });

  test("provideFileDecoration styles opencode rule mirrors", () => {
    state.workspaceFolderResolver = () => ({ name: "workspace" });
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const active = colorer.provideFileDecoration(
      Uri.file(path.join("/workspace", ".opencode", "rules", "ai-rules", "code.md"))
    );
    const disabled = colorer.provideFileDecoration(
      Uri.file(path.join("/workspace", ".opencode", "rules", "ai-rules", "code.md.disabled"))
    );

    assert.equal(active.color.id, "aiRulebook.activeForeground");
    assert.match(active.tooltip, /loaded by opencode/);
    assert.equal(disabled.color.id, "aiRulebook.inactiveForeground");
    assert.match(disabled.tooltip, /not loaded by opencode/);
  });

  test("provideFileDecoration styles Claude Code rule mirrors", () => {
    state.workspaceFolderResolver = () => ({ name: "workspace" });
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();
    const active = colorer.provideFileDecoration(
      Uri.file(path.join("/workspace", ".claude", "rules", "ai-rules", "code.md"))
    );
    const disabled = colorer.provideFileDecoration(
      Uri.file(path.join("/workspace", ".claude", "rules", "ai-rules", "code.md.disabled"))
    );

    assert.equal(active.color.id, "aiRulebook.activeForeground");
    assert.match(active.tooltip, /loaded by Claude Code/);
    assert.equal(disabled.color.id, "aiRulebook.inactiveForeground");
    assert.match(disabled.tooltip, /not loaded by Claude Code/);
  });

  test("provideFileDecoration leaves non-rule .md files outside opencode rules alone", () => {
    state.workspaceFolderResolver = () => ({ name: "workspace" });
    const colorer = new explorerDecorations.WorkspaceRuleFileColorer();

    assert.equal(
      colorer.provideFileDecoration(Uri.file(path.join("/workspace", "README.md"))),
      undefined
    );
    assert.equal(
      colorer.provideFileDecoration(
        Uri.file(path.join("/workspace", ".cursor", "rules", "ai-rules", "README.md"))
      ),
      undefined
    );
  });
});

describe("RuleStatusDecorationProvider", () => {
  test("provideFileDecoration styles active and disabled status URIs", () => {
    const provider = new sidebarTreeView.RuleStatusDecorationProvider();

    const active = provider.provideFileDecoration(
      Uri.from({ scheme: "ai-rules-status", path: "/on/core.mdc" })
    );
    const disabled = provider.provideFileDecoration(
      Uri.from({ scheme: "ai-rules-status", path: "/off/core.mdc" })
    );

    assert.equal(active.color.id, "aiRulebook.activeForeground");
    assert.equal(disabled.color.id, "aiRulebook.inactiveForeground");
  });

  test("provideFileDecoration ignores unrelated schemes and malformed status paths", () => {
    const provider = new sidebarTreeView.RuleStatusDecorationProvider();

    assert.equal(
      provider.provideFileDecoration(Uri.from({ scheme: "file", path: "/on/rule.mdc" })),
      undefined
    );
    assert.equal(
      provider.provideFileDecoration(
        Uri.from({ scheme: "ai-rules-status", path: "/unknown/rule.mdc" })
      ),
      undefined
    );
  });

  test("refresh emits a full decoration invalidation", () => {
    const provider = new sidebarTreeView.RuleStatusDecorationProvider();
    const emitted = [];
    provider.onDidChangeFileDecorations((value) => emitted.push(value));

    provider.refresh();

    assert.deepEqual(emitted, [undefined]);
  });
});

describe("RulesTreeProvider", () => {
  test("getChildren lists every topic rule", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/workspace") }];
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);

    const rules = await provider.getChildren();
    assert.deepEqual(
      rules,
      RULE_FILES.map((ruleFile) => ({ kind: "rule", ruleFile }))
    );
    assert.deepEqual(await provider.getChildren(rules[0]), []);
  });

  test("getTreeItem reflects active rule state and reveal command", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const ruleFile = SAMPLE_RULE;
    await writeFile(path.join(rulesOperations.workspaceRulesDir(root), ruleFile));
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);

    const item = await provider.getTreeItem({ kind: "rule", ruleFile });

    assert.equal(item.label, "Code");
    assert.equal(item.description, "Enabled");
    assert.equal(item.checkboxState, TreeItemCheckboxState.Checked);
    assert.equal(item.resourceUri.scheme, "ai-rules-status");
    assert.equal(item.resourceUri.path, `/on/${ruleFile}`);
    assert.deepEqual(item.command.arguments, [ruleFile]);
  });

  test("getTreeItem reports a rule as off when no workspace is open", async () => {
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);

    const item = await provider.getTreeItem({
      kind: "rule",
      ruleFile: SAMPLE_RULE,
    });

    assert.equal(item.description, "Disabled");
    assert.equal(item.checkboxState, TreeItemCheckboxState.Unchecked);
  });

  test("refresh notifies tree listeners and registered callbacks", () => {
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const treeEvents = [];
    let callbackCount = 0;
    provider.onDidChangeTreeData((value) => treeEvents.push(value));
    provider.onAfterRefresh(() => {
      callbackCount += 1;
    });

    provider.refresh();

    assert.deepEqual(treeEvents, [undefined]);
    assert.equal(callbackCount, 1);
  });
});

describe("bindRulesTreeView", () => {
  const ruleNode = { kind: "rule", ruleFile: SAMPLE_RULE };

  test("checkbox changes show a warning and restore the tree when no workspace is open", async () => {
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const refreshEvents = [];
    provider.onDidChangeTreeData((value) => refreshEvents.push(value));
    const context = { subscriptions: [] };
    let afterChangeCount = 0;

    const view = sidebarTreeView.bindRulesTreeView(context, provider, async () => {
      afterChangeCount += 1;
    });
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Checked]]);

    assert.deepEqual(state.warnings, ["AI Rulebook: open a folder before toggling rules."]);
    assert.deepEqual(refreshEvents, [undefined]);
    assert.equal(afterChangeCount, 0);
    assert.deepEqual(context.subscriptions, [view]);
  });

  test("checkbox changes toggle the rule and run post-change refreshes", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const rulesDir = rulesOperations.workspaceRulesDir(root);
    await writeFile(path.join(rulesDir, ruleNode.ruleFile));
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const context = { subscriptions: [] };
    let afterChangeCount = 0;

    const view = sidebarTreeView.bindRulesTreeView(context, provider, async () => {
      afterChangeCount += 1;
    });
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.equal(await rulesOperations.isRuleEnabled(rulesDir, ruleNode.ruleFile), false);
    assert.equal(
      await rulesOperations.pathExists(path.join(rulesDir, `${ruleNode.ruleFile}.disabled`)),
      true
    );
    assert.equal(afterChangeCount, 1);
  });

  test("checkbox changes mirror the toggle to opencode when evidence exists", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "AGENTS.md"), "# rules\n");
    const rulesDir = rulesOperations.workspaceRulesDir(root);
    await writeFile(
      path.join(rulesDir, ruleNode.ruleFile),
      "---\ndescription: x\nalwaysApply: true\n---\n\nBody\n"
    );
    await rulesOperations.mirrorRuleToOpencode(root, ruleNode.ruleFile, true);
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const context = { subscriptions: [] };
    const mirror = path.join(root, ".opencode", "rules", "ai-rules", "code.md");

    const view = sidebarTreeView.bindRulesTreeView(context, provider, async () => {});
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.equal(await rulesOperations.isRuleEnabled(rulesDir, ruleNode.ruleFile), false);
    assert.equal(await rulesOperations.pathExists(mirror), false);
    assert.equal(
      await rulesOperations.pathExists(`${mirror}.disabled`),
      true
    );
  });

  test("checkbox changes skip the opencode mirror when no evidence exists", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const rulesDir = rulesOperations.workspaceRulesDir(root);
    await writeFile(path.join(rulesDir, ruleNode.ruleFile));
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const context = { subscriptions: [] };

    const view = sidebarTreeView.bindRulesTreeView(context, provider, async () => {});
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.equal(
      await rulesOperations.pathExists(
        path.join(root, ".opencode", "rules", "ai-rules", "code.md.disabled")
      ),
      false
    );
  });

  test("checkbox changes mirror the toggle to Claude Code when evidence exists", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "CLAUDE.md"), "# rules\n");
    const rulesDir = rulesOperations.workspaceRulesDir(root);
    await writeFile(
      path.join(rulesDir, ruleNode.ruleFile),
      "---\ndescription: x\nalwaysApply: true\n---\n\nBody\n"
    );
    await rulesOperations.mirrorRuleToClaudeCode(root, ruleNode.ruleFile, true);
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const context = { subscriptions: [] };
    const mirror = path.join(root, ".claude", "rules", "ai-rules", "code.md");

    const view = sidebarTreeView.bindRulesTreeView(context, provider, async () => {});
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.equal(await rulesOperations.isRuleEnabled(rulesDir, ruleNode.ruleFile), false);
    assert.equal(await rulesOperations.pathExists(mirror), false);
    assert.equal(
      await rulesOperations.pathExists(`${mirror}.disabled`),
      true
    );
  });

  test("checkbox changes skip the Claude Code mirror when no evidence exists", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const rulesDir = rulesOperations.workspaceRulesDir(root);
    await writeFile(path.join(rulesDir, ruleNode.ruleFile));
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const context = { subscriptions: [] };

    const view = sidebarTreeView.bindRulesTreeView(context, provider, async () => {});
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.equal(
      await rulesOperations.pathExists(
        path.join(root, ".claude", "rules", "ai-rules", "code.md.disabled")
      ),
      false
    );
  });
});

describe("rule status UI", () => {
  test("createAiRulesOutputChannel uses the extension channel name", () => {
    const channel = ruleStatusUi.createAiRulesOutputChannel();

    assert.equal(channel.name, "AI Rulebook");
  });

  test("showRulePackStatusInOutput reports rule states without ANSI escapes", async (t) => {
    const rulesDir = await makeTempWorkspace();
    t.after(() => fs.rm(rulesDir, { recursive: true, force: true }));
    await writeFile(path.join(rulesDir, SAMPLE_RULE));
    const channel = ruleStatusUi.createAiRulesOutputChannel();

    await ruleStatusUi.showRulePackStatusInOutput(channel, rulesDir, [SAMPLE_RULE]);

    assert.equal(channel.clearCount, 1);
    assert.ok(channel.lines.includes(`active\t${SAMPLE_RULE}`));
    assert.doesNotMatch(channel.lines.join("\n"), /\u001b\[/);

    await rulesOperations.setRuleEnabled(rulesDir, SAMPLE_RULE, false);
    await ruleStatusUi.showRulePackStatusInOutput(channel, rulesDir, [SAMPLE_RULE]);
    assert.ok(channel.lines.includes(`off   \t${SAMPLE_RULE}`));
  });

});

describe("extension activation", () => {
  test("activate reports a manifest error and stops before registration", async (t) => {
    const emptyExtensionRoot = await makeTempWorkspace();
    t.after(() => fs.rm(emptyExtensionRoot, { recursive: true, force: true }));
    const { context, values } = makeExtensionContext(emptyExtensionRoot);

    await extension.activate(context);

    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], /failed to load rule pack/);
    assert.equal(state.registeredCommands.size, 0);
    assert.equal(values.size, 0);
  });

  test("activate registers every contributed command without an open workspace", async () => {
    const { context, values } = makeExtensionContext(repoRoot);
    const packageJson = JSON.parse(
      await fs.readFile(path.join(repoRoot, "package.json"), "utf8")
    );
    const contributedCommands = packageJson.contributes.commands
      .map((command) => command.command)
      .sort();

    await extension.activate(context);

    assert.deepEqual([...state.registeredCommands.keys()].sort(), contributedCommands);
    assert.equal(state.decorationProviders.length, 2);
    assert.equal(state.treeViews.length, 1);
    assert.equal(values.get("aiRules.lastSeenExtensionVersion"), "1.4.0");
    assert.equal(state.errors.length, 0);
  });

  test("activate auto-installs the topic rules for a Cursor workspace", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    vscode.env.uriScheme = "cursor";
    vscode.env.appName = "Cursor";
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    const rulesDir = rulesOperations.workspaceRulesDir(workspaceRoot);
    for (const ruleFile of RULE_FILES) {
      assert.equal(await rulesOperations.pathExists(path.join(rulesDir, ruleFile)), true);
    }
    assert.equal(await rulesOperations.pathExists(path.join(workspaceRoot, ".gitignore")), false);
    assert.ok(state.informationMessages.some((message) => /installed the rule pack/.test(message)));
    assert.ok(state.outputChannels[0].lines.some((line) => line === `active\t${SAMPLE_RULE}`));
  });

  test("activate leaves an existing rules folder alone and does not write .gitignore", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    vscode.env.uriScheme = "cursor";
    vscode.env.appName = "Cursor";
    await writeFile(
      path.join(rulesOperations.workspaceRulesDir(workspaceRoot), SAMPLE_RULE),
      "existing\n"
    );
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(
      await fs.readFile(
        path.join(rulesOperations.workspaceRulesDir(workspaceRoot), SAMPLE_RULE),
        "utf8"
      ),
      "existing\n"
    );
    assert.equal(await rulesOperations.pathExists(path.join(workspaceRoot, ".gitignore")), false);
  });

  test("workspace pack commands disable and enable every topic rule", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    const rulesDir = rulesOperations.workspaceRulesDir(workspaceRoot);
    await Promise.all(
      RULE_FILES.map((ruleFile) => writeFile(path.join(rulesDir, ruleFile)))
    );
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);

    await state.registeredCommands.get("aiRules.disableCoreWorkspace")();
    for (const ruleFile of RULE_FILES) {
      assert.equal(await rulesOperations.isRuleEnabled(rulesDir, ruleFile), false);
    }

    await state.registeredCommands.get("aiRules.enableCoreWorkspace")();
    for (const ruleFile of RULE_FILES) {
      assert.equal(await rulesOperations.isRuleEnabled(rulesDir, ruleFile), true);
    }
  });

  test("individual commands change only the selected topic rule", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    const rulesDir = rulesOperations.workspaceRulesDir(workspaceRoot);
    await Promise.all(
      RULE_FILES.map((ruleFile) => writeFile(path.join(rulesDir, ruleFile)))
    );
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);
    state.quickPickSelection = SAMPLE_RULE;

    await state.registeredCommands.get("aiRules.disableRuleWorkspace")();

    assert.equal(await rulesOperations.isRuleEnabled(rulesDir, SAMPLE_RULE), false);
    assert.equal(await rulesOperations.isRuleEnabled(rulesDir, RULE_FILES[1]), true);
    assert.deepEqual(state.quickPickRequests[0].items, RULE_FILES);

    await state.registeredCommands.get("aiRules.enableRuleWorkspace")();
    assert.equal(await rulesOperations.isRuleEnabled(rulesDir, SAMPLE_RULE), true);
  });

  test("bulk disable mirrors every rule off in the opencode folder", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "# rules\n");
    const rulesDir = rulesOperations.workspaceRulesDir(workspaceRoot);
    await Promise.all(
      RULE_FILES.map((ruleFile) => writeFile(path.join(rulesDir, ruleFile)))
    );
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);

    await state.registeredCommands.get("aiRules.disableCoreWorkspace")();

    const dest = path.join(workspaceRoot, ".opencode", "rules", "ai-rules");
    for (const ruleFile of RULE_FILES) {
      const mirrorName = ruleFile.replace(".mdc", ".md");
      assert.equal(await rulesOperations.pathExists(path.join(dest, mirrorName)), false);
      assert.equal(
        await rulesOperations.pathExists(path.join(dest, `${mirrorName}.disabled`)),
        true
      );
    }
  });

  test("bulk disable mirrors every rule off in the Claude Code folder", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# rules\n");
    const rulesDir = rulesOperations.workspaceRulesDir(workspaceRoot);
    await Promise.all(
      RULE_FILES.map((ruleFile) => writeFile(path.join(rulesDir, ruleFile)))
    );
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);

    await state.registeredCommands.get("aiRules.disableCoreWorkspace")();

    const dest = path.join(workspaceRoot, ".claude", "rules", "ai-rules");
    for (const ruleFile of RULE_FILES) {
      const mirrorName = ruleFile.replace(".mdc", ".md");
      assert.equal(await rulesOperations.pathExists(path.join(dest, mirrorName)), false);
      assert.equal(
        await rulesOperations.pathExists(path.join(dest, `${mirrorName}.disabled`)),
        true
      );
    }
  });

  test("activate mirrors to Cline without creating Cursor rules on a non-Cursor host", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    state.installedExtensions.add("saoudrizwan.claude-dev");
    const { context, values } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(
      await rulesOperations.pathExists(rulesOperations.workspaceRulesDir(workspaceRoot)),
      false
    );
    assert.equal(
      await rulesOperations.pathExists(
        path.join(workspaceRoot, ".clinerules", "ai-rules", "ai-rules-code.md")
      ),
      true
    );
    assert.equal(await rulesOperations.pathExists(path.join(workspaceRoot, ".gitignore")), false);
    assert.equal(values.get("aiRules.nonCursorHostNoticeShown"), true);
  });

  test("registered commands report workspace precondition failures", async () => {
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);

    await state.registeredCommands.get("aiRules.installWorkspace")();

    assert.ok(state.errors.some((message) => /Open a folder in VS Code first/.test(message)));
  });

  test("deactivate completes without cleanup errors", () => {
    assert.equal(extension.deactivate(), undefined);
  });
});
