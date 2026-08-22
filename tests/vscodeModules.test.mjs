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
const explorerDecorations = await import("../out/explorerDecorations.js");
const ruleStatusUi = await import("../out/ruleStatusUi.js");
const sidebarTreeView = await import("../out/sidebarTreeView.js");
const rulesOperations = await import("../out/rulesOperations.js");
const extension = await import("../out/extension.js");

Module._load = originalModuleLoad;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  test("getChildren lists only core.mdc", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/workspace") }];
    const provider = new sidebarTreeView.RulesTreeProvider();

    const rules = await provider.getChildren();
    assert.deepEqual(rules, [{ kind: "rule", ruleFile: "core.mdc" }]);
    assert.deepEqual(await provider.getChildren(rules[0]), []);
  });

  test("getTreeItem reflects active rule state and reveal command", async (t) => {
    const root = await makeTempWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const ruleFile = "core.mdc";
    await writeFile(path.join(rulesOperations.workspaceRulesDir(root), ruleFile));
    const provider = new sidebarTreeView.RulesTreeProvider();

    const item = await provider.getTreeItem({ kind: "rule", ruleFile });

    assert.equal(item.label, "Core");
    assert.equal(item.description, "Enabled");
    assert.equal(item.checkboxState, TreeItemCheckboxState.Checked);
    assert.equal(item.resourceUri.scheme, "ai-rules-status");
    assert.equal(item.resourceUri.path, `/on/${ruleFile}`);
    assert.deepEqual(item.command.arguments, [ruleFile]);
  });

  test("getTreeItem reports a rule as off when no workspace is open", async () => {
    const provider = new sidebarTreeView.RulesTreeProvider();

    const item = await provider.getTreeItem({
      kind: "rule",
      ruleFile: "core.mdc",
    });

    assert.equal(item.description, "Disabled");
    assert.equal(item.checkboxState, TreeItemCheckboxState.Unchecked);
  });

  test("refresh notifies tree listeners and registered callbacks", () => {
    const provider = new sidebarTreeView.RulesTreeProvider();
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
  const ruleNode = { kind: "rule", ruleFile: "core.mdc" };

  test("checkbox changes show a warning and restore the tree when no workspace is open", async () => {
    const provider = new sidebarTreeView.RulesTreeProvider();
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
    const provider = new sidebarTreeView.RulesTreeProvider();
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
});

describe("rule status UI", () => {
  test("createAiRulesOutputChannel uses the extension channel name", () => {
    const channel = ruleStatusUi.createAiRulesOutputChannel();

    assert.equal(channel.name, "AI Rulebook");
  });

  test("showCoreStatusInOutput reports both core rule states without ANSI escapes", async (t) => {
    const rulesDir = await makeTempWorkspace();
    t.after(() => fs.rm(rulesDir, { recursive: true, force: true }));
    const coreRule = "core.mdc";
    await writeFile(path.join(rulesDir, coreRule));
    const channel = ruleStatusUi.createAiRulesOutputChannel();

    await ruleStatusUi.showCoreStatusInOutput(channel, rulesDir, [coreRule]);

    assert.equal(channel.clearCount, 1);
    assert.ok(channel.lines.includes(`active\t${coreRule}`));
    assert.doesNotMatch(channel.lines.join("\n"), /\u001b\[/);

    await rulesOperations.setRuleEnabled(rulesDir, coreRule, false);
    await ruleStatusUi.showCoreStatusInOutput(channel, rulesDir, [coreRule]);
    assert.ok(channel.lines.includes(`off   \t${coreRule}`));
  });

});

describe("extension activation", () => {
  test("activate reports a manifest error and stops before registration", async (t) => {
    const emptyExtensionRoot = await makeTempWorkspace();
    t.after(() => fs.rm(emptyExtensionRoot, { recursive: true, force: true }));
    const { context, values } = makeExtensionContext(emptyExtensionRoot);

    await extension.activate(context);

    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], /failed to load core rule/);
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

  test("activate auto-installs core.mdc for a Cursor workspace", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    vscode.env.uriScheme = "cursor";
    vscode.env.appName = "Cursor";
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    const installedCore = path.join(
      rulesOperations.workspaceRulesDir(workspaceRoot),
      "core.mdc"
    );
    assert.equal(await rulesOperations.pathExists(installedCore), true);
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf8"),
      `${rulesOperations.GENERATED_RULE_IGNORE_ENTRIES.join("\n")}\n`
    );
    assert.ok(state.informationMessages.some((message) => /installed the core rule/.test(message)));
    assert.ok(state.outputChannels[0].lines.some((line) => line === "active\tcore.mdc"));
  });

  test("activate adds ignore entries when core.mdc already exists", async (t) => {
    const workspaceRoot = await makeTempWorkspace();
    t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
    workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }];
    vscode.env.uriScheme = "cursor";
    vscode.env.appName = "Cursor";
    await writeFile(
      path.join(rulesOperations.workspaceRulesDir(workspaceRoot), "core.mdc"),
      "existing\n"
    );
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(
      await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf8"),
      `${rulesOperations.GENERATED_RULE_IGNORE_ENTRIES.join("\n")}\n`
    );
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
        path.join(workspaceRoot, ".clinerules", "ai-rules", "ai-rules-core.md")
      ),
      true
    );
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf8"),
      `${rulesOperations.GENERATED_RULE_IGNORE_ENTRIES.join("\n")}\n`
    );
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
