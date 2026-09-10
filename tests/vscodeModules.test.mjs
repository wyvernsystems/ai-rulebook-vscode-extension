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
const ruleStatusUi = await import("../out/ruleStatusUi.js");
const sidebarTreeView = await import("../out/sidebarTreeView.js");
const rulesOperations = await import("../out/rulesOperations.js");
const agentsMd = await import("../out/agentsMd.js");
const claudeMd = await import("../out/claudeMd.js");
const extension = await import("../out/extension.js");

Module._load = originalModuleLoad;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(repoRoot, "bundled", "ai-rules");
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

async function readAgentsMd(root) {
  return fs.readFile(agentsMd.agentsMdPath(root), "utf8");
}

async function installPack(root, testCommand = null) {
  await agentsMd.installRulesIntoAgentsMd(root, bundleDir, RULE_FILES, testCommand);
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

/** Activates against the real bundle with auto-install off, in the given folders. */
async function activateIn(roots) {
  workspace.workspaceFolders = roots.map((root) => ({ uri: Uri.file(root) }));
  state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
  const { context, values } = makeExtensionContext(repoRoot);
  await extension.activate(context);
  return { context, values };
}

function tempWorkspaces(t, count) {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const root = await makeTempWorkspace();
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      return root;
    })
  );
}

describe("Cursor host detection", () => {
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

describe("RuleStatusDecorationProvider", () => {
  test("colors on and off rule URIs and ignores other schemes", () => {
    const provider = new sidebarTreeView.RuleStatusDecorationProvider();

    const on = provider.provideFileDecoration(
      Uri.from({ scheme: "ai-rules-status", path: `/on/${SAMPLE_RULE}` })
    );
    const off = provider.provideFileDecoration(
      Uri.from({ scheme: "ai-rules-status", path: `/off/${SAMPLE_RULE}` })
    );

    assert.equal(on.color.id, "aiRulebook.activeForeground");
    assert.match(on.tooltip, /AGENTS\.md/);
    assert.equal(off.color.id, "aiRulebook.inactiveForeground");
    assert.equal(provider.provideFileDecoration(Uri.file("/x/AGENTS.md")), undefined);
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

  test("getTreeItem reflects the rule's state in AGENTS.md and the reveal command", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await installPack(root);
    await agentsMd.setRuleEnabledInAgentsMd(root, bundleDir, "git.mdc", false, null);
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);

    const item = await provider.getTreeItem({ kind: "rule", ruleFile: SAMPLE_RULE });
    assert.equal(item.label, "Code");
    assert.equal(item.description, "Enabled");
    assert.equal(item.checkboxState, TreeItemCheckboxState.Checked);
    assert.equal(item.resourceUri.scheme, "ai-rules-status");
    assert.equal(item.resourceUri.path, `/on/${SAMPLE_RULE}`);
    assert.deepEqual(item.command.arguments, [SAMPLE_RULE]);

    const off = await provider.getTreeItem({ kind: "rule", ruleFile: "git.mdc" });
    assert.equal(off.description, "Disabled");
    assert.equal(off.checkboxState, TreeItemCheckboxState.Unchecked);
    assert.equal(off.resourceUri.path, "/off/git.mdc");
  });

  test("getTreeItem reports a rule as off when no workspace is open", async () => {
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);

    const item = await provider.getTreeItem({ kind: "rule", ruleFile: SAMPLE_RULE });

    assert.equal(item.description, "Disabled");
    assert.equal(item.checkboxState, TreeItemCheckboxState.Unchecked);
  });

  test("getTreeItem exposes a damaged block without claiming the rule is disabled", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "AGENTS.md"), agentsMd.AGENTS_MD_BLOCK_START + "\n");
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const item = await provider.getTreeItem({ kind: "rule", ruleFile: SAMPLE_RULE });
    assert.equal(item.description, "Unable to read");
    assert.match(item.tooltip, /AGENTS\.md/);
    assert.equal(item.checkboxState, undefined);
    assert.equal(item.resourceUri, undefined);
    assert.equal(item.iconPath.id, "warning");
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
    const toggles = [];
    let afterChangeCount = 0;

    const view = sidebarTreeView.bindRulesTreeView(
      context,
      provider,
      async (...args) => {
        toggles.push(args);
      },
      async () => {
        afterChangeCount += 1;
      }
    );
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Checked]]);

    assert.deepEqual(state.warnings, ["AI Rulebook: open a folder before toggling rules."]);
    assert.deepEqual(refreshEvents, [undefined]);
    assert.deepEqual(toggles, []);
    assert.equal(afterChangeCount, 0);
    assert.deepEqual(context.subscriptions, [view]);
  });

  test("checkbox changes warn when AGENTS.md has no rule pack yet", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "AGENTS.md"), "# project\n");
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const toggles = [];

    const view = sidebarTreeView.bindRulesTreeView(
      { subscriptions: [] },
      provider,
      async (...args) => {
        toggles.push(args);
      },
      async () => {}
    );
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.ok(state.warnings.some((message) => /Install \/ update rule pack/.test(message)));
    assert.deepEqual(toggles, []);
    assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "# project\n");
  });

  test("checkbox changes hand the toggle to the caller, then refresh", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await installPack(root);
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    const events = [];

    const view = sidebarTreeView.bindRulesTreeView(
      { subscriptions: [] },
      provider,
      async (toggleRoot, ruleFile, enabled) => {
        events.push(["toggle", toggleRoot, ruleFile, enabled]);
        await agentsMd.setRuleEnabledInAgentsMd(toggleRoot, bundleDir, ruleFile, enabled, null);
      },
      async () => {
        events.push(["after"]);
      }
    );
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.deepEqual(events, [["toggle", root, SAMPLE_RULE, false], ["after"]]);
    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, SAMPLE_RULE), false);
    assert.deepEqual(state.errors, []);
  });

  test("a failing toggle is reported as an error and the tree still refreshes", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await installPack(root);
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    let afterChangeCount = 0;

    const view = sidebarTreeView.bindRulesTreeView(
      { subscriptions: [] },
      provider,
      async () => {
        throw new Error("disk full");
      },
      async () => {
        afterChangeCount += 1;
      }
    );
    await view.emitCheckboxState([[ruleNode, TreeItemCheckboxState.Unchecked]]);

    assert.ok(state.errors.some((message) => /code\.mdc.*disk full/.test(message)));
    assert.equal(afterChangeCount, 1);
  });
});

describe("rule status UI", () => {
  test("createAiRulesOutputChannel uses the extension channel name", () => {
    const channel = ruleStatusUi.createAiRulesOutputChannel();

    assert.equal(channel.name, "AI Rulebook");
  });

  test("showRulePackStatusInOutput reports rule states without ANSI escapes", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    const channel = ruleStatusUi.createAiRulesOutputChannel();

    await ruleStatusUi.showRulePackStatusInOutput(channel, root, [SAMPLE_RULE]);

    assert.equal(channel.clearCount, 1);
    assert.ok(channel.lines.includes(`active\t${SAMPLE_RULE}`));
    assert.doesNotMatch(channel.lines.join("\n"), /\[/);

    await agentsMd.setRuleEnabledInAgentsMd(root, bundleDir, SAMPLE_RULE, false, null);
    await ruleStatusUi.showRulePackStatusInOutput(channel, root, [SAMPLE_RULE]);
    assert.ok(channel.lines.includes(`off   \t${SAMPLE_RULE}`));
  });
});

describe("extension activation", () => {
  test("activate reports a manifest error and stops before registration", async (t) => {
    const [emptyExtensionRoot] = await tempWorkspaces(t, 1);
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
    assert.equal(state.decorationProviders.length, 1);
    assert.equal(state.treeViews.length, 1);
    assert.equal(values.get("aiRules.lastSeenExtensionVersion"), "1.4.0");
    assert.equal(state.errors.length, 0);
    assert.equal(state.statusBarItems[0].text, "$(checklist) AI Rulebook");
  });

  test("activate installs into a workspace that already has an AGENTS.md", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "AGENTS.md"), "# My project\n\nUse tabs.\n");
    await writeFile(path.join(root, "package.json"), '{"scripts":{"test":"vitest"}}\n');
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    const text = await readAgentsMd(root);
    assert.ok(text.startsWith("# My project\n\nUse tabs.\n\n" + agentsMd.AGENTS_MD_BLOCK_START));
    assert.ok(text.includes("`npm test`"), "test command detected from package.json");
    for (const ruleFile of RULE_FILES) {
      assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, ruleFile), true, ruleFile);
    }
    assert.equal(await fs.readFile(claudeMd.claudeMdPath(root), "utf8"), "@AGENTS.md\n");
    assert.equal(await rulesOperations.pathExists(path.join(root, ".gitignore")), false);
    assert.equal(await rulesOperations.pathExists(path.join(root, ".cursor")), false);
    assert.ok(state.informationMessages.some((message) => /AGENTS\.md/.test(message)));
    assert.ok(state.outputChannels[0].lines.some((line) => line === `active\t${SAMPLE_RULE}`));
    assert.match(state.statusBarItems[0].text, /AI 6\/6/);
  });

  test("activate installs on a Cursor host even without agent files", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    vscode.env.uriScheme = "cursor";
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(await agentsMd.hasRulesBlock(root), true);
    assert.ok((await readAgentsMd(root)).startsWith("# AGENTS.md\n\n"));
    assert.equal(await rulesOperations.pathExists(claudeMd.claudeMdPath(root)), true);
  });

  test("activate installs when Cline is installed even without agent files", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    state.installedExtensions.add("saoudrizwan.claude-dev");
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(await agentsMd.hasRulesBlock(root), true);
  });

  test("activate skips a workspace with no agent evidence and shows a one-time hint", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "README.md"), "# hi\n");
    const { context, values } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(await rulesOperations.pathExists(agentsMd.agentsMdPath(root)), false);
    assert.equal(await rulesOperations.pathExists(claudeMd.claudeMdPath(root)), false);
    assert.equal(values.get("aiRules.autoInstallSkippedNoticeShown"), true);
    assert.ok(
      state.informationMessages.some((message) => /Install \/ update rule pack/.test(message)),
      `expected an install hint, got ${JSON.stringify(state.informationMessages)}`
    );

    resetVscodeMock();
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await extension.activate(context);
    assert.deepEqual(state.informationMessages, [], "the hint is shown once per machine");
  });

  test("activate honors aiRules.autoInstallOnOpenWorkspace = false", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await writeFile(path.join(root, "AGENTS.md"), "# project\n");
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(await readAgentsMd(root), "# project\n");
    assert.equal(await rulesOperations.pathExists(claudeMd.claudeMdPath(root)), false);
  });

  test("activate leaves an installed block alone, including disabled rules", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    await installPack(root, "make test");
    await agentsMd.setRuleEnabledInAgentsMd(root, bundleDir, "git.mdc", false, "make test");
    const before = await readAgentsMd(root);
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.equal(await readAgentsMd(root), before);
    assert.match(state.statusBarItems[0].text, /AI 5\/6/);
    assert.equal(await rulesOperations.pathExists(claudeMd.claudeMdPath(root)), false);
  });

  test("activate reports a damaged block instead of throwing", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const damaged = "# p\n\n" + agentsMd.AGENTS_MD_BLOCK_START + "\n";
    await writeFile(path.join(root, "AGENTS.md"), damaged);
    const { context } = makeExtensionContext(repoRoot);

    await extension.activate(context);

    assert.ok(state.errors.some((message) => /ai-rulebook:end/.test(message)), state.errors.join());
    assert.equal(await readAgentsMd(root), damaged);
    assert.match(state.statusBarItems[0].text, /warning/);
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

describe("install command", () => {
  test("installWorkspace writes AGENTS.md and CLAUDE.md into every open folder", async (t) => {
    const roots = await tempWorkspaces(t, 2);
    await writeFile(path.join(roots[1], "CLAUDE.md"), "# Notes\n");
    await writeFile(path.join(roots[1], "Cargo.toml"), "[package]\n");
    await activateIn(roots);

    await state.registeredCommands.get("aiRules.installWorkspace")();

    for (const root of roots) {
      assert.equal(await agentsMd.hasRulesBlock(root), true, root);
    }
    assert.ok((await readAgentsMd(roots[0])).includes("the project's test command"));
    assert.ok((await readAgentsMd(roots[1])).includes("`cargo test`"));
    assert.equal(await fs.readFile(claudeMd.claudeMdPath(roots[0]), "utf8"), "@AGENTS.md\n");
    assert.equal(
      await fs.readFile(claudeMd.claudeMdPath(roots[1]), "utf8"),
      "# Notes\n\n@AGENTS.md\n"
    );
    assert.ok(
      state.informationMessages.some((message) => /2 folders/.test(message)),
      state.informationMessages.join(" | ")
    );
    assert.match(state.statusBarItems[0].text, /AI 6\/6/);
  });

  test("installWorkspace keeps a disabled rule disabled while refreshing the text", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root, "old test");
    await agentsMd.setRuleEnabledInAgentsMd(root, bundleDir, "git.mdc", false, "old test");
    await writeFile(path.join(root, "go.mod"), "module x\n");
    await activateIn([root]);

    await state.registeredCommands.get("aiRules.installWorkspace")();

    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, "git.mdc"), false);
    const text = await readAgentsMd(root);
    assert.ok(text.includes("`go test ./...`"));
    assert.ok(!text.includes("`old test`"));
  });
});

describe("rule toggle commands", () => {
  test("workspace pack commands disable and enable every topic rule", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);

    await state.registeredCommands.get("aiRules.disableCoreWorkspace")();
    for (const ruleFile of RULE_FILES) {
      assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, ruleFile), false, ruleFile);
    }
    assert.ok(!(await readAgentsMd(root)).includes("## Scope"));
    assert.match(state.statusBarItems[0].text, /AI 0\/6/);

    await state.registeredCommands.get("aiRules.enableCoreWorkspace")();
    for (const ruleFile of RULE_FILES) {
      assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, ruleFile), true, ruleFile);
    }
    assert.ok((await readAgentsMd(root)).includes("## Scope"));
    assert.match(state.statusBarItems[0].text, /AI 6\/6/);
  });

  test("individual commands change only the selected topic rule", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);
    state.quickPickSelection = SAMPLE_RULE;

    await state.registeredCommands.get("aiRules.disableRuleWorkspace")();

    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, SAMPLE_RULE), false);
    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, RULE_FILES[1]), true);
    assert.deepEqual(state.quickPickRequests[0].items, RULE_FILES);
    assert.ok(state.informationMessages.some((message) => /code\.mdc disabled/.test(message)));

    await state.registeredCommands.get("aiRules.enableRuleWorkspace")();
    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, SAMPLE_RULE), true);
  });

  test("toggles apply to the first workspace folder only", async (t) => {
    const roots = await tempWorkspaces(t, 2);
    for (const root of roots) {
      await installPack(root);
    }
    await activateIn(roots);
    state.quickPickSelection = SAMPLE_RULE;

    await state.registeredCommands.get("aiRules.disableRuleWorkspace")();

    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(roots[0], SAMPLE_RULE), false);
    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(roots[1], SAMPLE_RULE), true);
  });

  test("the sidebar checkbox edits the rule's section in AGENTS.md", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);
    const view = state.treeViews[0];

    await view.emitCheckboxState([
      [{ kind: "rule", ruleFile: "tests.mdc" }, TreeItemCheckboxState.Unchecked],
    ]);

    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, "tests.mdc"), false);
    assert.ok(!(await readAgentsMd(root)).includes("## Tests"));
    assert.match(state.statusBarItems[0].text, /AI 5\/6/);
    assert.deepEqual(state.errors, []);
  });
});

describe("rule toggles without an installed rule pack", () => {
  async function activateWithoutRules(t) {
    const [root] = await tempWorkspaces(t, 1);
    await writeFile(path.join(root, "AGENTS.md"), "# project\n");
    await activateIn([root]);
    return root;
  }

  test("enableCoreWorkspace reports the missing rule pack instead of a false success", async (t) => {
    const root = await activateWithoutRules(t);
    state.informationMessages = [];

    await state.registeredCommands.get("aiRules.enableCoreWorkspace")();

    assert.ok(
      state.errors.some((message) => /Install \/ update rule pack/.test(message)),
      `expected an install hint, got ${JSON.stringify(state.errors)}`
    );
    assert.deepEqual(state.informationMessages, []);
    assert.equal(await readAgentsMd(root), "# project\n");
  });

  test("disableRuleWorkspace reports the missing rule pack instead of a false success", async (t) => {
    await activateWithoutRules(t);
    state.quickPickSelection = SAMPLE_RULE;
    state.informationMessages = [];

    await state.registeredCommands.get("aiRules.disableRuleWorkspace")();

    assert.ok(
      state.errors.some((message) => /Install \/ update rule pack/.test(message)),
      `expected an install hint, got ${JSON.stringify(state.errors)}`
    );
    assert.deepEqual(state.informationMessages, []);
  });

  test("sidebar checkbox toggles warn instead of silently doing nothing", async (t) => {
    const root = await activateWithoutRules(t);
    const view = state.treeViews[0];

    await view.emitCheckboxState([
      [{ kind: "rule", ruleFile: SAMPLE_RULE }, TreeItemCheckboxState.Unchecked],
    ]);

    assert.ok(
      state.warnings.some((message) => /Install \/ update rule pack/.test(message)),
      `expected an install hint, got ${JSON.stringify(state.warnings)}`
    );
    assert.equal(await readAgentsMd(root), "# project\n");
  });
});

describe("remove commands", () => {
  test("a declined confirmation leaves the rule pack in place", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);
    state.warningChoice = "Cancel";

    await state.registeredCommands.get("aiRules.removeWorkspace")();

    assert.equal(await agentsMd.hasRulesBlock(root), true);
    assert.ok(state.warningRequests[0].modal);
  });

  test("removeWorkspace clears the block in every folder and deletes files it created", async (t) => {
    const roots = await tempWorkspaces(t, 2);
    await writeFile(path.join(roots[1], "AGENTS.md"), "# Mine\n");
    await writeFile(path.join(roots[1], "CLAUDE.md"), "# Notes\n");
    await activateIn(roots);
    await state.registeredCommands.get("aiRules.installWorkspace")();
    state.warningChoice = "Remove rule pack";

    await state.registeredCommands.get("aiRules.removeWorkspace")();

    assert.equal(await rulesOperations.pathExists(agentsMd.agentsMdPath(roots[0])), false);
    assert.equal(await rulesOperations.pathExists(claudeMd.claudeMdPath(roots[0])), false);
    assert.equal(await readAgentsMd(roots[1]), "# Mine\n");
    assert.equal(
      await fs.readFile(claudeMd.claudeMdPath(roots[1]), "utf8"),
      "# Notes\n\n@AGENTS.md\n",
      "the import stays while AGENTS.md still exists"
    );
    assert.ok(state.informationMessages.some((message) => /removed/i.test(message)));
    assert.equal(state.statusBarItems[0].text, "$(checklist) AI 0/6");
  });

  test("removeLegacyFoldersWorkspace deletes the per-tool folders from every folder", async (t) => {
    const roots = await tempWorkspaces(t, 2);
    for (const root of roots) {
      await writeFile(path.join(root, ".cursor", "rules", "ai-rules", "code.mdc"), "x\n");
      await writeFile(path.join(root, ".claude", "rules", "ai-rules", "code.md"), "x\n");
      await writeFile(path.join(root, ".opencode", "command", "ai-rulebook.md"), "x\n");
      await installPack(root);
    }
    await activateIn(roots);
    state.warningChoice = "Remove legacy folders";

    await state.registeredCommands.get("aiRules.removeLegacyFoldersWorkspace")();

    for (const root of roots) {
      assert.equal(await rulesOperations.pathExists(path.join(root, ".cursor", "rules", "ai-rules")), false);
      assert.equal(await rulesOperations.pathExists(path.join(root, ".claude", "rules", "ai-rules")), false);
      assert.equal(
        await rulesOperations.pathExists(path.join(root, ".opencode", "command", "ai-rulebook.md")),
        false
      );
      assert.equal(await agentsMd.hasRulesBlock(root), true, "AGENTS.md is untouched");
    }
    assert.ok(state.informationMessages.some((message) => /Cursor: removed/.test(message)));
  });
});

describe("status and reveal commands", () => {
  test("showCoreStatus focuses the sidebar and reports rule state", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);

    await state.registeredCommands.get("aiRules.showCoreStatus")();

    assert.ok(
      state.executedCommands.some(([id]) => id === "aiRules.rulesTree.focus"),
      "expected the sidebar to be focused"
    );
    assert.ok(state.outputChannels[0].lines.some((line) => line === `active\t${SAMPLE_RULE}`));
    assert.deepEqual(state.errors, []);
  });

  test("the status bar opens the status command", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await activateIn([root]);

    assert.equal(state.statusBarItems[0].command, "aiRules.showCoreStatus");
  });

  test("revealRuleFile opens AGENTS.md at the rule's section", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);
    const text = await readAgentsMd(root);
    const expectedLine = agentsMd.ruleSectionLine(text, "git.mdc");

    await state.registeredCommands.get("aiRules.revealRuleFile")("git.mdc");

    assert.equal(state.openedDocuments[0].fileName, agentsMd.agentsMdPath(root));
    assert.equal(state.shownDocuments[0].options.selection.start.line, expectedLine);
    assert.equal(state.shownDocuments[0].options.preview, true);
  });

  test("revealRuleFile warns when the pack is not installed and ignores bad input", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await activateIn([root]);

    await state.registeredCommands.get("aiRules.revealRuleFile")("git.mdc");
    assert.ok(state.warnings.some((message) => /Install \/ update rule pack/.test(message)));

    await state.registeredCommands.get("aiRules.revealRuleFile")("../etc/passwd");
    await state.registeredCommands.get("aiRules.revealRuleFile")("not-bundled.mdc");
    assert.equal(state.openedDocuments.length, 0);
  });
});

describe("update prompt", () => {
  test("offers to refresh installed rules when the extension version changes", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const { context, values } = makeExtensionContext(repoRoot);
    values.set("aiRules.lastSeenExtensionVersion", "1.0.0");

    await extension.activate(context);

    assert.ok(state.informationMessages.some((message) => /updated to v1\.4\.0/.test(message)));
    assert.equal(values.get("aiRules.lastSeenExtensionVersion"), "1.4.0");
  });
});

describe("command and UI edge cases", () => {
  test("sidebar has no children without a workspace and ignores unknown decoration paths", async () => {
    const provider = new sidebarTreeView.RulesTreeProvider(RULE_FILES);
    assert.deepEqual(await provider.getChildren(), []);
    const colors = new sidebarTreeView.RuleStatusDecorationProvider();
    assert.equal(colors.provideFileDecoration(Uri.from({ scheme: "ai-rules-status", path: "/unknown/code.mdc" })), undefined);
  });

  for (const files of [[], ["notes.md"]]) {
    test(`activation rejects unusable manifest files ${JSON.stringify(files)}`, async (t) => {
      const [root] = await tempWorkspaces(t, 1);
      await writeFile(path.join(root, "bundled", "manifest.json"), JSON.stringify({ version: 1, files }));
      const { context } = makeExtensionContext(root);
      await extension.activate(context);
      assert.equal(state.registeredCommands.size, 0);
      assert.equal(state.errors.length, 1);
      assert.match(state.errors[0], /at least one .mdc rule/);
    });
  }

  test("cancelling a rule picker preserves the file and emits no success message", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);
    const original = await readAgentsMd(root);
    state.informationMessages = [];
    await state.registeredCommands.get("aiRules.disableRuleWorkspace")();
    assert.equal(await readAgentsMd(root), original);
    assert.deepEqual(state.informationMessages, []);
    assert.deepEqual(state.errors, []);
  });

  test("cancelling legacy cleanup preserves old rule files", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    const file = path.join(root, ".cursor", "rules", "ai-rules", "code.mdc");
    await writeFile(file, "old rules\n");
    await activateIn([root]);
    await state.registeredCommands.get("aiRules.removeLegacyFoldersWorkspace")();
    assert.equal(await fs.readFile(file, "utf8"), "old rules\n");
    assert.deepEqual(state.errors, []);
  });

  test("removing an absent pack reports nothing removed and preserves user text", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await writeFile(agentsMd.agentsMdPath(root), "# Project\n");
    await activateIn([root]);
    state.warningChoice = "Remove rule pack";
    await state.registeredCommands.get("aiRules.removeWorkspace")();
    assert.equal(await readAgentsMd(root), "# Project\n");
    assert.ok(state.informationMessages.some((message) => /nothing removed/.test(message)));
  });

  test("refresh reads external changes and reports unreadable AGENTS.md", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root);
    await activateIn([root]);
    await agentsMd.setRuleEnabledInAgentsMd(root, bundleDir, SAMPLE_RULE, false, null);
    await state.registeredCommands.get("aiRules.refreshTree")();
    assert.match(state.statusBarItems[0].text, /AI 5\/6/);
    await fs.unlink(agentsMd.agentsMdPath(root));
    await fs.mkdir(agentsMd.agentsMdPath(root));
    await state.registeredCommands.get("aiRules.refreshTree")();
    assert.match(state.statusBarItems[0].text, /warning/);
    assert.match(state.statusBarItems[0].tooltip, /Failed to read AGENTS\.md/);
  });

  test("auto-install continues to the next workspace after a project-file read failure", async (t) => {
    const roots = await tempWorkspaces(t, 3);
    workspace.workspaceFolders = roots.map((root) => ({ uri: Uri.file(root) }));
    vscode.env.uriScheme = "cursor";
    await fs.mkdir(path.join(roots[0], "package.json"));
    const { context } = makeExtensionContext(repoRoot);
    await extension.activate(context);
    assert.equal(await agentsMd.hasRulesBlock(roots[0]), false);
    for (const root of roots.slice(1)) assert.equal(await agentsMd.hasRulesBlock(root), true);
    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], /auto-install.*failed.*package\.json/);
    assert.ok(state.informationMessages.some((message) => /in 2 folders/.test(message)));
  });

  test("accepting an update prompt refreshes rules while preserving disabled state", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    await installPack(root, "old test");
    await agentsMd.setRuleEnabledInAgentsMd(root, bundleDir, "git.mdc", false, null);
    await writeFile(path.join(root, "go.mod"), "module example\n");
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    const { context, values } = makeExtensionContext(repoRoot);
    values.set("aiRules.lastSeenExtensionVersion", "1.0.0");
    t.mock.method(vscode.window, "showInformationMessage", async () => "Install / update in workspace");
    await extension.activate(context);
    assert.ok(state.executedCommands.some(([id]) => id === "aiRules.installWorkspace"));
    assert.match(await readAgentsMd(root), /`go test \.\/\.\.\.`/);
    assert.equal(await agentsMd.isRuleEnabledInAgentsMd(root, "git.mdc"), false);
    assert.equal(values.get("aiRules.lastSeenExtensionVersion"), "1.4.0");
  });

  test("disabled update prompts record the version without asking to refresh", async (t) => {
    const [root] = await tempWorkspaces(t, 1);
    workspace.workspaceFolders = [{ uri: Uri.file(root) }];
    state.configuration.set("aiRules.autoInstallOnOpenWorkspace", false);
    state.configuration.set("aiRules.promptInstallOnUpdate", false);
    const { context, values } = makeExtensionContext(repoRoot);
    values.set("aiRules.lastSeenExtensionVersion", "1.0.0");
    await extension.activate(context);
    assert.deepEqual(state.informationMessages, []);
    assert.equal(values.get("aiRules.lastSeenExtensionVersion"), "1.4.0");
  });
});
