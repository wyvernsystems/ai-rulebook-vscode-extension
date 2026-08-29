import * as path from "node:path";
import * as vscode from "vscode";
import { shouldAutoSyncClaude, syncRulePackToClaude } from "./claude";
import { isClineInstalled, shouldAutoSyncCline } from "./cline";
import {
  isCursorHost,
  readCursorInstallPolicy,
  shouldAutoInstallCursorRules,
} from "./cursor";
import { readBundleManifest, type BundleManifest } from "./manifest";
import { shouldAutoSyncOpencode, syncRulePackToOpencode } from "./opencode";
import {
  createAiRulesOutputChannel,
  showRulePackStatusInOutput,
} from "./ruleStatusUi";
import {
  installRulePack,
  mirrorRuleToClaudeCode,
  mirrorRuleToCline,
  mirrorRuleToOpencode,
  OPENCODE_RULES_GLOB,
  pathExists,
  removeAllRuleFormats,
  removeClaudeRules,
  removeClineRules,
  removeCursorRules,
  removeOpencodeRules,
  resetRulesDirToBundle,
  setRuleEnabled,
  syncBundledMdcsToClinerules,
  syncClaudeMirrorFromWorkspace,
  syncClineMirrorFromWorkspace,
  syncOpencodeMirrorFromWorkspace,
  workspaceRulesDir,
} from "./rulesOperations";
import { assertContainedPath, isSafeManifestEntry } from "./safePaths";
import { detectTestCommand } from "./testCommand";
import { COLOR_RULES_IN_EXPLORER_SETTING, WorkspaceRuleFileColorer } from "./explorerDecorations";
import {
  bindRulesTreeView,
  RuleStatusDecorationProvider,
  RulesTreeProvider,
  RULES_TREE_VIEW_ID,
} from "./sidebarTreeView";

const LAST_SEEN_VERSION_KEY = "aiRules.lastSeenExtensionVersion";
const NON_CURSOR_NOTICE_KEY = "aiRules.nonCursorHostNoticeShown";

function getAiRulesBoolean(key: string, defaultValue: boolean): boolean {
  const v = vscode.workspace.getConfiguration("aiRules").get(key);
  if (typeof v === "boolean") {
    return v;
  }
  return defaultValue;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extensionRoot = context.extensionPath;
  const bundleDir = path.join(extensionRoot, "bundled", "ai-rules");
  let manifest: BundleManifest;
  try {
    manifest = readBundleManifest(extensionRoot);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(
      `AI Rulebook: failed to load rule pack — ${reason}. Reinstall the extension or rebuild the bundle.`
    );
    return;
  }

  if (manifest.files.length === 0 || manifest.files.some((file) => !file.endsWith(".mdc"))) {
    vscode.window.showErrorMessage(
      "AI Rulebook: bundled manifest must contain at least one .mdc rule and no other files. Reinstall the extension or rebuild the bundle."
    );
    return;
  }
  const mdcs = manifest.files;
  const rulesOutput = createAiRulesOutputChannel();
  context.subscriptions.push(rulesOutput);

  const sidebarColors = new RuleStatusDecorationProvider();
  const explorerColors = new WorkspaceRuleFileColorer();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(sidebarColors),
    vscode.window.registerFileDecorationProvider(explorerColors),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(COLOR_RULES_IN_EXPLORER_SETTING)) {
        explorerColors.refresh();
      }
    })
  );

  const treeProvider = new RulesTreeProvider(mdcs);
  treeProvider.onAfterRefresh(() => sidebarColors.refresh());
  treeProvider.onAfterRefresh(() => explorerColors.refresh());
  /**
   * Refresh handle used after every action that changes rule state on disk.
   * `treeProvider.refresh()` also fires every registered decoration provider
   * via `onAfterRefresh`, so call sites only need to refresh the tree.
   */
  const refreshSidebar = (): Promise<void> => {
    treeProvider.refresh();
    return Promise.resolve();
  };
  bindRulesTreeView(context, treeProvider, refreshSidebar);

  const ensureWorkspace = (): string => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      throw new Error("Open a folder in VS Code first.");
    }
    return folder;
  };

  /** Returns true if Cline mirror was written. */
  const maybeAutoSyncCline = async (root: string): Promise<boolean> => {
    if (!shouldAutoSyncCline()) {
      return false;
    }
    await syncBundledMdcsToClinerules(root, bundleDir, mdcs, await detectTestCommand(root));
    return true;
  };

  /** Returns true if the opencode mirror was written. */
  const maybeAutoSyncOpencode = async (root: string): Promise<boolean> => {
    if (!(await shouldAutoSyncOpencode(root))) {
      return false;
    }
    await syncRulePackToOpencode(root, bundleDir, mdcs, await detectTestCommand(root));
    return true;
  };

  /** Returns true if the Claude Code mirror was written. */
  const maybeAutoSyncClaude = async (root: string): Promise<boolean> => {
    if (!(await shouldAutoSyncClaude(root))) {
      return false;
    }
    await syncRulePackToClaude(root, bundleDir, mdcs, await detectTestCommand(root));
    return true;
  };

  let clineWasInstalled = isClineInstalled();
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      const now = isClineInstalled();
      if (!clineWasInstalled && shouldAutoSyncCline()) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
          void detectTestCommand(root)
            .then((testCommand) =>
              syncBundledMdcsToClinerules(root, bundleDir, mdcs, testCommand)
            )
            .then(() => {
              vscode.window.showInformationMessage(
                "AI Rulebook: Cline detected—synced the rule pack to `.clinerules/ai-rules/`."
              );
            });
        }
      }
      clineWasInstalled = now;
    })
  );

  /**
   * Shows a one-time hint when the user is on a non-Cursor host and the
   * `installCursorRulesFolder` policy resolved to "skip the auto-install".
   * Persisted via `globalState` so the toast never repeats per-machine
   * regardless of how many workspaces are opened. Manual install / reset
   * commands work irrespective of this banner.
   */
  const maybeShowNonCursorNotice = async (): Promise<void> => {
    if (readCursorInstallPolicy() !== "auto") {
      return;
    }
    if (isCursorHost()) {
      return;
    }
    const alreadyShown = context.globalState.get<boolean>(NON_CURSOR_NOTICE_KEY) === true;
    if (alreadyShown) {
      return;
    }
    await context.globalState.update(NON_CURSOR_NOTICE_KEY, true);
    const pick = await vscode.window.showInformationMessage(
      `AI Rulebook: detected ${vscode.env.appName} (not Cursor). Skipping the .cursor/rules/ai-rules/ auto-install. ` +
        `Run "AI Rulebook: Install / update rule pack" if you want it anyway, or set ` +
        `"aiRules.installCursorRulesFolder" to "always" to disable this check.`,
      "Install now",
      "Open setting",
      "Dismiss"
    );
    if (pick === "Install now") {
      await vscode.commands.executeCommand("aiRules.installWorkspace");
    } else if (pick === "Open setting") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "aiRules.installCursorRulesFolder"
      );
    }
  };

  /**
   * Idempotent first-time install: if the workspace has no
   * `.cursor/rules/ai-rules` folder yet, install the bundled rule pack.
   * Existing rules folders are left untouched so the user never gets a
   * surprise overwrite—use "Install / update" or "Reset" for that.
   *
   * Gated by `aiRules.installCursorRulesFolder`:
   *   - "auto"   (default): install only when the host is Cursor.
   *   - "always": install regardless of host (useful when committing the
   *               folder for Cursor-using teammates while editing in plain
   *               VS Code).
   *   - "never":  never auto-install. Manual commands still work.
   *
   * Cline mirroring runs independently and is gated by its own setting plus
   * the Cline-installed check, so a Cline user on plain VS Code still gets
   * `.clinerules/ai-rules/` even if `.cursor/rules/` is skipped here.
   */
  const autoInstallIfMissing = async (): Promise<void> => {
    if (!getAiRulesBoolean("autoInstallOnOpenWorkspace", true)) {
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return;
    }
    const rulesDir = workspaceRulesDir(root);
    if (await pathExists(rulesDir)) {
      return;
    }
    if (!(await pathExists(bundleDir))) {
      return;
    }

    const writeCursorRules = shouldAutoInstallCursorRules();
    const wantCline = shouldAutoSyncCline();
    const wantOpencode = await shouldAutoSyncOpencode(root);
    const wantClaude = await shouldAutoSyncClaude(root);
    const testCommand = await detectTestCommand(root);

    if (!writeCursorRules) {
      // Cline, opencode, and Claude Code still mirror independently; only skip the .cursor/ install.
      const parts: string[] = [];
      if (wantCline) {
        await syncBundledMdcsToClinerules(root, bundleDir, mdcs, testCommand);
        parts.push("Cline: synced to `.clinerules/ai-rules/`.");
      }
      if (wantOpencode) {
        await syncRulePackToOpencode(root, bundleDir, mdcs, testCommand);
        parts.push("opencode: synced to `.opencode/rules/ai-rules/`.");
      }
      if (wantClaude) {
        await syncRulePackToClaude(root, bundleDir, mdcs, testCommand);
        parts.push("Claude Code: synced to `.claude/rules/ai-rules/`.");
      }
      if (parts.length > 0) {
        vscode.window.showInformationMessage(
          "AI Rulebook: " +
            parts.join(" ") +
            " Skipped `.cursor/rules/ai-rules/` (host is not Cursor — change " +
            "`aiRules.installCursorRulesFolder` to `always` to install anyway)."
        );
      }
      await maybeShowNonCursorNotice();
      treeProvider.refresh();
      return;
    }

    await installRulePack(bundleDir, rulesDir, mdcs, testCommand);
    const parts = [
      "AI Rulebook: installed the rule pack into `.cursor/rules/ai-rules/`.",
    ];
    if (wantCline) {
      await syncBundledMdcsToClinerules(root, bundleDir, mdcs, testCommand);
      parts.push("Cline: synced to `.clinerules/ai-rules/`.");
    }
    if (wantOpencode) {
      await syncRulePackToOpencode(root, bundleDir, mdcs, testCommand);
      parts.push("opencode: synced to `.opencode/rules/ai-rules/`.");
    }
    if (wantClaude) {
      await syncRulePackToClaude(root, bundleDir, mdcs, testCommand);
      parts.push("Claude Code: synced to `.claude/rules/ai-rules/`.");
    }
    vscode.window.showInformationMessage(parts.join(" "));
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void autoInstallIfMissing();
    })
  );

  const register = (command: string, fn: () => Promise<void>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        try {
          await fn();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`AI Rulebook: ${msg}`);
        }
      })
    );
  };

  register("aiRules.installWorkspace", async () => {
    const root = ensureWorkspace();
    const rulesDir = workspaceRulesDir(root);
    if (!(await pathExists(bundleDir))) {
      throw new Error(`Missing bundle at ${bundleDir}`);
    }
    const testCommand = await detectTestCommand(root);
    await installRulePack(bundleDir, rulesDir, mdcs, testCommand);
    const parts = ["AI Rulebook: installed the rule pack into `.cursor/rules/ai-rules/`."];
    if (shouldAutoSyncCline()) {
      await syncBundledMdcsToClinerules(root, bundleDir, mdcs, testCommand);
      parts.push("Cline: synced to `.clinerules/ai-rules/`.");
    }
    if (await shouldAutoSyncOpencode(root)) {
      await syncRulePackToOpencode(root, bundleDir, mdcs, testCommand);
      parts.push("opencode: synced to `.opencode/rules/ai-rules/`.");
    }
    if (await shouldAutoSyncClaude(root)) {
      await syncRulePackToClaude(root, bundleDir, mdcs, testCommand);
      parts.push("Claude Code: synced to `.claude/rules/ai-rules/`.");
    }
    vscode.window.showInformationMessage(parts.join(" "));
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  });

  const setSelectedRuleEnabled = async (enabled: boolean): Promise<void> => {
    const root = ensureWorkspace();
    const action = enabled ? "enable" : "disable";
    const ruleFile = await vscode.window.showQuickPick(mdcs, {
      placeHolder: `Select a rule to ${action}`,
    });
    if (!ruleFile) {
      return;
    }
    const rulesDir = workspaceRulesDir(root);
    await setRuleEnabled(rulesDir, ruleFile, enabled);
    if (shouldAutoSyncCline()) {
      await mirrorRuleToCline(root, ruleFile, enabled);
    }
    if (await shouldAutoSyncOpencode(root)) {
      await mirrorRuleToOpencode(root, ruleFile, enabled);
    }
    if (await shouldAutoSyncClaude(root)) {
      await mirrorRuleToClaudeCode(root, ruleFile, enabled);
    }
    vscode.window.showInformationMessage(
      `AI Rulebook: ${ruleFile} ${enabled ? "enabled" : "disabled"} in this workspace.`
    );
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  };

  register("aiRules.enableRuleWorkspace", () => setSelectedRuleEnabled(true));
  register("aiRules.disableRuleWorkspace", () => setSelectedRuleEnabled(false));

  register("aiRules.enableCoreWorkspace", async () => {
    const root = ensureWorkspace();
    const rulesDir = workspaceRulesDir(root);
    await Promise.all(mdcs.map((ruleFile) => setRuleEnabled(rulesDir, ruleFile, true)));
    if (shouldAutoSyncCline()) {
      await syncClineMirrorFromWorkspace(root, mdcs);
    }
    if (await shouldAutoSyncOpencode(root)) {
      await syncOpencodeMirrorFromWorkspace(root, mdcs);
    }
    if (await shouldAutoSyncClaude(root)) {
      await syncClaudeMirrorFromWorkspace(root, mdcs);
    }
    vscode.window.showInformationMessage("AI Rulebook: all rules enabled in this workspace.");
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  });

  register("aiRules.disableCoreWorkspace", async () => {
    const root = ensureWorkspace();
    const rulesDir = workspaceRulesDir(root);
    await Promise.all(mdcs.map((ruleFile) => setRuleEnabled(rulesDir, ruleFile, false)));
    if (shouldAutoSyncCline()) {
      await syncClineMirrorFromWorkspace(root, mdcs);
    }
    if (await shouldAutoSyncOpencode(root)) {
      await syncOpencodeMirrorFromWorkspace(root, mdcs);
    }
    if (await shouldAutoSyncClaude(root)) {
      await syncClaudeMirrorFromWorkspace(root, mdcs);
    }
    vscode.window.showInformationMessage("AI Rulebook: all rules disabled in this workspace.");
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  });

  /**
   * Writes `aiRules.colorRulesInExplorer` to whichever scope is currently
   * overriding the value, so toggling actually flips the *effective* value:
   *
   *   - if the user set it per-folder, update that folder
   *   - else if it's set at the workspace level, update the workspace
   *   - else update the User (Global) scope
   *
   * Without this, "Hide rule colors" silently no-ops when a Workspace-level
   * `true` shadows our `Global` write.
   */
  const setColorRulesInExplorer = async (enabled: boolean): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration("aiRules");
    const inspect = cfg.inspect<boolean>("colorRulesInExplorer");
    let target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global;
    if (inspect?.workspaceFolderValue !== undefined) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    } else if (inspect?.workspaceValue !== undefined) {
      target = vscode.ConfigurationTarget.Workspace;
    }
    await cfg.update("colorRulesInExplorer", enabled, target);
  };

  /**
   * Symmetric pair with `aiRules.hideRuleColors`: turns the Explorer green
   * tint back on (idempotent—no-op if already on), refreshes the sidebar,
   * focuses it, and writes a plain-text snapshot to the Output channel.
   */
  register("aiRules.showCoreStatus", async () => {
    const root = ensureWorkspace();
    const cfg = vscode.workspace.getConfiguration("aiRules");
    if (cfg.get<boolean>("colorRulesInExplorer", true) !== true) {
      await setColorRulesInExplorer(true);
    }
    explorerColors.refresh();
    treeProvider.refresh();
    await vscode.commands.executeCommand(`${RULES_TREE_VIEW_ID}.focus`);
    await showRulePackStatusInOutput(rulesOutput, workspaceRulesDir(root), mdcs);
  });

  /**
   * Removes the green / red tint from rule files in the workbench
   * Explorer by flipping `aiRules.colorRulesInExplorer` to `false`. Writes to
   * whichever scope currently overrides the value (folder > workspace > user)
   * so the *effective* value flips—a Global-only write would be shadowed by
   * a Workspace `true` and the colors would stay. Sidebar coloring is
   * unaffected—the sidebar exists to show on/off state, so removing color
   * there would defeat its purpose.
   */
  register("aiRules.hideRuleColors", async () => {
    await setColorRulesInExplorer(false);
    explorerColors.refresh();
    vscode.window.showInformationMessage(
      "AI Rulebook: Explorer rule colors hidden. Run “AI Rulebook: Show rule pack status” to bring them back."
    );
  });

  register("aiRules.syncCursorWorkspace", async () => {
    const root = ensureWorkspace();
    if (!(await pathExists(bundleDir))) {
      throw new Error(`Missing bundle at ${bundleDir}`);
    }
    const rulesDir = workspaceRulesDir(root);
    const testCommand = await detectTestCommand(root);
    await installRulePack(bundleDir, rulesDir, mdcs, testCommand);
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.cursor/rules/ai-rules/`."
    );
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  });

  register("aiRules.syncClineWorkspace", async () => {
    const root = ensureWorkspace();
    await syncBundledMdcsToClinerules(root, bundleDir, mdcs, await detectTestCommand(root));
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.clinerules/ai-rules/`."
    );
  });

  register("aiRules.syncOpencodeWorkspace", async () => {
    const root = ensureWorkspace();
    const result = await syncRulePackToOpencode(
      root,
      bundleDir,
      mdcs,
      await detectTestCommand(root)
    );
    if (result === "skipped") {
      vscode.window.showWarningMessage(
        'AI Rulebook: wrote the rule pack to `.opencode/rules/ai-rules/` but could not ' +
          "update the opencode config (unrecognized format). Add " +
          `"instructions": ["${OPENCODE_RULES_GLOB}"] to your opencode config manually.`
      );
      return;
    }
    const configNote =
      result === "created-config"
        ? " Created `.opencode/opencode.json` with the instructions entry."
        : result === "updated-config"
          ? " Updated the instructions entry in the opencode config."
          : "";
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.opencode/rules/ai-rules/`." + configNote
    );
  });

  register("aiRules.syncClaudeWorkspace", async () => {
    const root = ensureWorkspace();
    await syncRulePackToClaude(root, bundleDir, mdcs, await detectTestCommand(root));
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.claude/rules/ai-rules/`."
    );
  });

  register("aiRules.syncAllFormatsWorkspace", async () => {
    const root = ensureWorkspace();
    if (!(await pathExists(bundleDir))) {
      throw new Error(`Missing bundle at ${bundleDir}`);
    }
    const rulesDir = workspaceRulesDir(root);
    const testCommand = await detectTestCommand(root);
    await installRulePack(bundleDir, rulesDir, mdcs, testCommand);
    await syncBundledMdcsToClinerules(root, bundleDir, mdcs, testCommand);
    const opencodeResult = await syncRulePackToOpencode(root, bundleDir, mdcs, testCommand);
    await syncRulePackToClaude(root, bundleDir, mdcs, testCommand);

    const parts = [
      "AI Rulebook: synced the rule pack to `.cursor/rules/ai-rules/`, `.clinerules/ai-rules/`, `.opencode/rules/ai-rules/`, and `.claude/rules/ai-rules/`.",
    ];
    if (opencodeResult === "skipped") {
      vscode.window.showWarningMessage(
        'AI Rulebook: wrote the opencode rule files but could not update the opencode config ' +
          "(unrecognized format). Add " +
          `"instructions": ["${OPENCODE_RULES_GLOB}"] to your opencode config manually.`
      );
    } else {
      vscode.window.showInformationMessage(parts.join(" "));
    }
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    treeProvider.refresh();
  });

  const confirmDestructive = async (message: string, action: string): Promise<boolean> => {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, action, "Cancel");
    return choice === action;
  };

  const formatRemovalMessage = (removed: boolean, label: string): string =>
    removed ? `${label}: removed.` : `${label}: nothing to remove.`;

  register("aiRules.removeCursorWorkspace", async () => {
    const root = ensureWorkspace();
    const confirmed = await confirmDestructive(
      "Remove the Cursor rule pack from `.cursor/rules/ai-rules/`?\n\n" +
        "Unsaved or uncommitted edits in that folder may be lost.",
      "Remove Cursor rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeCursorRules(root);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Cursor")}`
    );
    treeProvider.refresh();
  });

  register("aiRules.removeClineWorkspace", async () => {
    const root = ensureWorkspace();
    const confirmed = await confirmDestructive(
      "Remove the Cline rule pack from `.clinerules/ai-rules/`?",
      "Remove Cline rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeClineRules(root);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Cline")}`
    );
  });

  register("aiRules.removeOpencodeWorkspace", async () => {
    const root = ensureWorkspace();
    const confirmed = await confirmDestructive(
      "Remove the opencode rule pack from `.opencode/rules/ai-rules/`?\n\n" +
        "The opencode config `instructions` entry is not edited automatically.",
      "Remove opencode rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeOpencodeRules(root);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "opencode")}`
    );
  });

  register("aiRules.removeClaudeWorkspace", async () => {
    const root = ensureWorkspace();
    const confirmed = await confirmDestructive(
      "Remove the Claude Code rule pack from `.claude/rules/ai-rules/`?",
      "Remove Claude Code rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeClaudeRules(root);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Claude Code")}`
    );
  });

  register("aiRules.removeAllFormatsWorkspace", async () => {
    const root = ensureWorkspace();
    const confirmed = await confirmDestructive(
      "Remove every AI Rulebook rule pack from this workspace?\n\n" +
        "• `.cursor/rules/ai-rules/`\n" +
        "• `.clinerules/ai-rules/`\n" +
        "• `.opencode/rules/ai-rules/`\n" +
        "• `.claude/rules/ai-rules/`\n\n" +
        "Unsaved or uncommitted edits may be lost.",
      "Remove all rule packs"
    );
    if (!confirmed) {
      return;
    }
    const result = await removeAllRuleFormats(root);
    const parts = [
      formatRemovalMessage(result.cursor, "Cursor"),
      formatRemovalMessage(result.cline, "Cline"),
      formatRemovalMessage(result.opencode, "opencode"),
      formatRemovalMessage(result.claude, "Claude Code"),
    ];
    vscode.window.showInformationMessage(`AI Rulebook: ${parts.join(" ")}`);
    treeProvider.refresh();
  });

  register("aiRules.refreshTree", async () => {
    treeProvider.refresh();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("aiRules.revealRuleFile", async (rulePath?: string) => {
      if (typeof rulePath !== "string" || !isSafeManifestEntry(rulePath)) {
        return;
      }
      if (!manifest.files.includes(rulePath)) {
        return;
      }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showWarningMessage("AI Rulebook: open a folder before opening a rule.");
        return;
      }
      const rulesDir = workspaceRulesDir(root);
      const enabledPath = path.join(rulesDir, rulePath);
      const disabledPath = `${enabledPath}.disabled`;
      assertContainedPath(rulesDir, enabledPath, "rules directory");
      const target = (await pathExists(enabledPath))
        ? enabledPath
        : (await pathExists(disabledPath))
          ? disabledPath
          : null;
      if (!target) {
        vscode.window.showWarningMessage(
          `AI Rulebook: ${rulePath} is not in this workspace yet—run “Install / update rule pack” first.`
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  register("aiRules.resetWorkspaceRulesToDefaults", async () => {
    const root = ensureWorkspace();
    const choice = await vscode.window.showWarningMessage(
      "Reset `.cursor/rules/ai-rules` to the AI Rulebook extension defaults?\n\n" +
        "• All files in that folder will be replaced from the bundled copy.\n" +
        "• Any extra rule files you added there will be deleted.\n" +
        "• Unsaved or uncommitted edits in that folder may be lost—commit or stash first if needed.",
      { modal: true },
      "Reset to defaults",
      "Cancel"
    );
    if (choice !== "Reset to defaults") {
      return;
    }
    await resetRulesDirToBundle(bundleDir, workspaceRulesDir(root), await detectTestCommand(root));
    const clineSynced = await maybeAutoSyncCline(root);
    const opencodeSynced = await maybeAutoSyncOpencode(root);
    const claudeSynced = await maybeAutoSyncClaude(root);
    vscode.window.showInformationMessage(
      "AI Rulebook: workspace rules folder reset to defaults." +
        (clineSynced ? " Cline: synced to `.clinerules/ai-rules/`." : "") +
        (opencodeSynced ? " opencode: synced to `.opencode/rules/ai-rules/`." : "") +
        (claudeSynced ? " Claude Code: synced to `.claude/rules/ai-rules/`." : "")
    );
    await showRulePackStatusInOutput(rulesOutput, workspaceRulesDir(root), mdcs);
    treeProvider.refresh();
  });

  await autoInstallIfMissing();

  const current = context.extension.packageJSON.version as string;
  const prev = context.globalState.get<string>(LAST_SEEN_VERSION_KEY);
  if (
    getAiRulesBoolean("promptInstallOnUpdate", true) &&
    prev &&
    prev !== current &&
    vscode.workspace.workspaceFolders?.length
  ) {
    const pick = await vscode.window.showInformationMessage(
      `AI Rulebook extension updated to v${current}. Refresh workspace rules from the bundle?`,
      "Install / update in workspace",
      "Not now"
    );
    if (pick === "Install / update in workspace") {
      await vscode.commands.executeCommand("aiRules.installWorkspace");
    }
  }
  await context.globalState.update(LAST_SEEN_VERSION_KEY, current);
}

export function deactivate(): void {}
