import * as path from "node:path";
import * as vscode from "vscode";
import { shouldAutoSyncClaude, syncRulePackToClaude } from "./claude";
import { isClineInstalled, shouldAutoSyncCline } from "./cline";
import { shouldAutoSyncCopilot, syncRulePackToCopilot } from "./copilot";
import {
  isCursorHost,
  readCursorInstallPolicy,
  shouldAutoInstallCursorRules,
} from "./cursor";
import { readBundleManifest, type BundleManifest } from "./manifest";
import {
  opencodeSyncStatus,
  removeOpencodeCommandFile,
  shouldAutoSyncOpencode,
  syncRulePackToOpencode,
} from "./opencode";
import {
  createAiRulesOutputChannel,
  showRulePackStatusInOutput,
} from "./ruleStatusUi";
import {
  installRulePack,
  isRuleEnabled,
  mirrorRuleToClaudeCode,
  mirrorRuleToCline,
  mirrorRuleToCopilot,
  mirrorRuleToOpencode,
  mirrorRuleToWindsurf,
  OPENCODE_RULES_GLOB,
  pathExists,
  removeAllRuleFormats,
  removeClaudeRules,
  removeClineRules,
  removeCopilotRules,
  removeCursorRules,
  removeOpencodeRules,
  removeWindsurfRules,
  resetRulesDirToBundle,
  setRuleEnabled,
  syncBundledMdcsToClinerules,
  syncClaudeMirrorFromWorkspace,
  syncClineMirrorFromWorkspace,
  syncCopilotMirrorFromWorkspace,
  syncOpencodeMirrorFromWorkspace,
  syncWindsurfMirrorFromWorkspace,
  type OpencodeConfigMergeResult,
  type TestCommand,
  workspaceRulesDir,
} from "./rulesOperations";
import { shouldAutoSyncWindsurf, syncRulePackToWindsurf } from "./windsurf";
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

/** Every open workspace folder's fsPath, in order (multi-root aware). */
function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => folder.uri.fsPath)
    .filter((fsPath): fsPath is string => typeof fsPath === "string" && fsPath.length > 0);
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
   * Status bar element: shows the enabled-rule count in the first workspace
   * folder plus the opencode mirror state, and clicks through to the manual
   * opencode sync command.
   */
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.name = "AI Rulebook";
  statusBarItem.command = "aiRules.syncOpencodeWorkspace";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = async (): Promise<void> => {
    const root = workspaceRoots()[0];
    if (!root) {
      statusBarItem.text = "$(checklist) AI Rulebook";
      statusBarItem.tooltip = "AI Rulebook: open a folder to install the rule pack.";
      return;
    }
    const rulesDir = workspaceRulesDir(root);
    let enabledCount = 0;
    for (const ruleFile of mdcs) {
      if (await isRuleEnabled(rulesDir, ruleFile)) {
        enabledCount++;
      }
    }
    const opencodeState = await opencodeSyncStatus(root);
    const opencodeSuffix =
      opencodeState === "synced" ? " · opencode ✓" : opencodeState === "skipped" ? " · opencode ✗" : "";
    statusBarItem.text = `$(checklist) AI ${enabledCount}/${mdcs.length}${opencodeSuffix}`;
    statusBarItem.tooltip =
      `AI Rulebook: ${enabledCount}/${mdcs.length} rules enabled in the first workspace folder.\n` +
      "Click to sync the rule pack to opencode.";
  };

  /**
   * Refresh handle used after every action that changes rule state on disk.
   * `treeProvider.refresh()` also fires every registered decoration provider
   * via `onAfterRefresh`; the status bar reads the disk asynchronously, so it
   * is awaited here rather than fired and forgotten. Every command that writes
   * or deletes rule files must await this, including the mirror-only sync and
   * remove commands—the status bar reports the opencode mirror state too.
   */
  const refreshUi = async (): Promise<void> => {
    treeProvider.refresh();
    await updateStatusBar();
  };

  const ensureWorkspace = (): string => {
    const folder = workspaceRoots()[0];
    if (!folder) {
      throw new Error("Open a folder in VS Code first.");
    }
    return folder;
  };

  /** Every open workspace folder, or a clear error when none is open. */
  const ensureWorkspaces = (): string[] => {
    const roots = workspaceRoots();
    if (roots.length === 0) {
      throw new Error("Open a folder in VS Code first.");
    }
    return roots;
  };

  /**
   * Guards the rule on / off commands: toggling renames `<rule>.mdc` to
   * `<rule>.mdc.disabled` in `.cursor/rules/ai-rules/`, so with no rules folder
   * there is nothing to rename and the toggle would silently do nothing while
   * still reporting success.
   */
  const ensureRulePackInstalled = async (rulesDir: string): Promise<void> => {
    if (!(await pathExists(rulesDir))) {
      throw new Error(
        "No rule pack in this workspace yet — run \"AI Rulebook: Install / update rule pack\" first."
      );
    }
  };

  /**
   * Refreshes `.cursor/rules/ai-rules/` from the bundle while preserving each
   * rule's on / off state. `installRulePack` deliberately converges every rule
   * to enabled, which is what "Install / update" and "Reset to defaults" mean;
   * a *sync* must not silently re-enable rules the user turned off, because the
   * mirrors it then writes are generated from that state.
   */
  const refreshCursorRulesPreservingState = async (
    rulesDir: string,
    testCommand: TestCommand
  ): Promise<void> => {
    const disabledBefore: string[] = [];
    if (await pathExists(rulesDir)) {
      for (const ruleFile of mdcs) {
        if (!(await isRuleEnabled(rulesDir, ruleFile))) {
          disabledBefore.push(ruleFile);
        }
      }
    }
    await installRulePack(bundleDir, rulesDir, mdcs, testCommand);
    for (const ruleFile of disabledBefore) {
      await setRuleEnabled(rulesDir, ruleFile, false);
    }
  };

  /**
   * Syncs the opencode mirror and warns when the project's opencode config
   * could not be updated (`"skipped"`), so auto-sync surfaces the same issue
   * the manual command reports.
   */
  const syncOpencodeWithWarning = async (
    root: string,
    testCommand: TestCommand
  ): Promise<OpencodeConfigMergeResult> => {
    const result = await syncRulePackToOpencode(root, bundleDir, mdcs, testCommand);
    if (result === "skipped") {
      vscode.window.showWarningMessage(
        'AI Rulebook: wrote the opencode rule files but could not update the opencode config ' +
          "(unrecognized format). Add " +
          `"instructions": ["${OPENCODE_RULES_GLOB}"] to your opencode config manually.`
      );
    }
    return result;
  };

  /** Returns true if a Cline mirror was written in any workspace folder. */
  const maybeAutoSyncCline = async (): Promise<boolean> => {
    if (!shouldAutoSyncCline()) {
      return false;
    }
    let synced = false;
    for (const root of workspaceRoots()) {
      await syncBundledMdcsToClinerules(root, bundleDir, mdcs, await detectTestCommand(root));
      synced = true;
    }
    return synced;
  };

  /** Returns true if an opencode mirror was written in any workspace folder. */
  const maybeAutoSyncOpencode = async (): Promise<boolean> => {
    let synced = false;
    for (const root of workspaceRoots()) {
      if (!(await shouldAutoSyncOpencode(root))) {
        continue;
      }
      await syncOpencodeWithWarning(root, await detectTestCommand(root));
      synced = true;
    }
    return synced;
  };

  /** Returns true if a Claude Code mirror was written in any workspace folder. */
  const maybeAutoSyncClaude = async (): Promise<boolean> => {
    let synced = false;
    for (const root of workspaceRoots()) {
      if (!(await shouldAutoSyncClaude(root))) {
        continue;
      }
      await syncRulePackToClaude(root, bundleDir, mdcs, await detectTestCommand(root));
      synced = true;
    }
    return synced;
  };

  /** Returns true if a Windsurf mirror was written in any workspace folder. */
  const maybeAutoSyncWindsurf = async (): Promise<boolean> => {
    let synced = false;
    for (const root of workspaceRoots()) {
      if (!(await shouldAutoSyncWindsurf(root))) {
        continue;
      }
      await syncRulePackToWindsurf(root, bundleDir, mdcs, await detectTestCommand(root));
      synced = true;
    }
    return synced;
  };

  /** Returns true if a GitHub Copilot mirror was written in any workspace folder. */
  const maybeAutoSyncCopilot = async (): Promise<boolean> => {
    let synced = false;
    for (const root of workspaceRoots()) {
      if (!(await shouldAutoSyncCopilot(root))) {
        continue;
      }
      await syncRulePackToCopilot(root, bundleDir, mdcs, await detectTestCommand(root));
      synced = true;
    }
    return synced;
  };

  /**
   * Reflects a single rule toggle to every available mirror (Cline, opencode,
   * Claude Code, Windsurf, GitHub Copilot) in every workspace folder that has
   * them enabled. Used by the sidebar checkbox handler and the enable /
   * disable-one commands.
   */
  const propagateRuleToggle = async (ruleFile: string, enabled: boolean): Promise<void> => {
    for (const root of workspaceRoots()) {
      if (shouldAutoSyncCline()) {
        await mirrorRuleToCline(root, ruleFile, enabled);
      }
      if (await shouldAutoSyncOpencode(root)) {
        await mirrorRuleToOpencode(root, ruleFile, enabled);
      }
      if (await shouldAutoSyncClaude(root)) {
        await mirrorRuleToClaudeCode(root, ruleFile, enabled);
      }
      if (await shouldAutoSyncWindsurf(root)) {
        await mirrorRuleToWindsurf(root, ruleFile, enabled);
      }
      if (await shouldAutoSyncCopilot(root)) {
        await mirrorRuleToCopilot(root, ruleFile, enabled);
      }
    }
  };

  /** Reflects the saved state of all rules to every available mirror, per folder. */
  const syncMirrorsFromWorkspace = async (): Promise<void> => {
    for (const root of workspaceRoots()) {
      if (shouldAutoSyncCline()) {
        await syncClineMirrorFromWorkspace(root, mdcs);
      }
      if (await shouldAutoSyncOpencode(root)) {
        await syncOpencodeMirrorFromWorkspace(root, mdcs);
      }
      if (await shouldAutoSyncClaude(root)) {
        await syncClaudeMirrorFromWorkspace(root, mdcs);
      }
      if (await shouldAutoSyncWindsurf(root)) {
        await syncWindsurfMirrorFromWorkspace(root, mdcs);
      }
      if (await shouldAutoSyncCopilot(root)) {
        await syncCopilotMirrorFromWorkspace(root, mdcs);
      }
    }
  };

  bindRulesTreeView(context, treeProvider, refreshUi, propagateRuleToggle);

  let clineWasInstalled = isClineInstalled();
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      const now = isClineInstalled();
      if (!clineWasInstalled && shouldAutoSyncCline()) {
        for (const root of workspaceRoots()) {
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
    const root = workspaceRoots()[0];
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

    if (!writeCursorRules) {
      // Cline, opencode, Claude Code, Windsurf, and Copilot still mirror
      // independently; only skip the .cursor/ install.
      const parts: string[] = [];
      if (await maybeAutoSyncCline()) {
        parts.push("Cline: synced to `.clinerules/ai-rules/`.");
      }
      if (await maybeAutoSyncOpencode()) {
        parts.push("opencode: synced to `.opencode/rules/ai-rules/`.");
      }
      if (await maybeAutoSyncClaude()) {
        parts.push("Claude Code: synced to `.claude/rules/ai-rules/`.");
      }
      if (await maybeAutoSyncWindsurf()) {
        parts.push("Windsurf: synced to `.windsurf/rules/ai-rules/`.");
      }
      if (await maybeAutoSyncCopilot()) {
        parts.push("GitHub Copilot: synced to `.github/instructions/ai-rules/`.");
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
      await refreshUi();
      return;
    }

    await installRulePack(bundleDir, rulesDir, mdcs, await detectTestCommand(root));
    const parts = [
      "AI Rulebook: installed the rule pack into `.cursor/rules/ai-rules/`.",
    ];
    if (await maybeAutoSyncCline()) {
      parts.push("Cline: synced to `.clinerules/ai-rules/`.");
    }
    if (await maybeAutoSyncOpencode()) {
      parts.push("opencode: synced to `.opencode/rules/ai-rules/`.");
    }
    if (await maybeAutoSyncClaude()) {
      parts.push("Claude Code: synced to `.claude/rules/ai-rules/`.");
    }
    if (await maybeAutoSyncWindsurf()) {
      parts.push("Windsurf: synced to `.windsurf/rules/ai-rules/`.");
    }
    if (await maybeAutoSyncCopilot()) {
      parts.push("GitHub Copilot: synced to `.github/instructions/ai-rules/`.");
    }
    vscode.window.showInformationMessage(parts.join(" "));
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void autoInstallIfMissing();
      void updateStatusBar();
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
    await installRulePack(bundleDir, rulesDir, mdcs, await detectTestCommand(root));
    const parts = ["AI Rulebook: installed the rule pack into `.cursor/rules/ai-rules/`."];
    if (await maybeAutoSyncCline()) {
      parts.push("Cline: synced to `.clinerules/ai-rules/`.");
    }
    if (await maybeAutoSyncOpencode()) {
      parts.push("opencode: synced to `.opencode/rules/ai-rules/`.");
    }
    if (await maybeAutoSyncClaude()) {
      parts.push("Claude Code: synced to `.claude/rules/ai-rules/`.");
    }
    if (await maybeAutoSyncWindsurf()) {
      parts.push("Windsurf: synced to `.windsurf/rules/ai-rules/`.");
    }
    if (await maybeAutoSyncCopilot()) {
      parts.push("GitHub Copilot: synced to `.github/instructions/ai-rules/`.");
    }
    vscode.window.showInformationMessage(parts.join(" "));
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  });

  const setSelectedRuleEnabled = async (enabled: boolean): Promise<void> => {
    const root = ensureWorkspace();
    const rulesDir = workspaceRulesDir(root);
    await ensureRulePackInstalled(rulesDir);
    const action = enabled ? "enable" : "disable";
    const ruleFile = await vscode.window.showQuickPick(mdcs, {
      placeHolder: `Select a rule to ${action}`,
    });
    if (!ruleFile) {
      return;
    }
    await setRuleEnabled(rulesDir, ruleFile, enabled);
    await propagateRuleToggle(ruleFile, enabled);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${ruleFile} ${enabled ? "enabled" : "disabled"} in this workspace.`
    );
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  };

  register("aiRules.enableRuleWorkspace", () => setSelectedRuleEnabled(true));
  register("aiRules.disableRuleWorkspace", () => setSelectedRuleEnabled(false));

  register("aiRules.enableCoreWorkspace", async () => {
    const root = ensureWorkspace();
    const rulesDir = workspaceRulesDir(root);
    await ensureRulePackInstalled(rulesDir);
    await Promise.all(mdcs.map((ruleFile) => setRuleEnabled(rulesDir, ruleFile, true)));
    await syncMirrorsFromWorkspace();
    vscode.window.showInformationMessage("AI Rulebook: all rules enabled in this workspace.");
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  });

  register("aiRules.disableCoreWorkspace", async () => {
    const root = ensureWorkspace();
    const rulesDir = workspaceRulesDir(root);
    await ensureRulePackInstalled(rulesDir);
    await Promise.all(mdcs.map((ruleFile) => setRuleEnabled(rulesDir, ruleFile, false)));
    await syncMirrorsFromWorkspace();
    vscode.window.showInformationMessage("AI Rulebook: all rules disabled in this workspace.");
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  });

  /**
   * Writes `aiRules.colorRulesInExplorer` to whichever scope is currently
   * overriding the value, so toggling actually flips the *effective* value:
   *
   *   - if it's set at the workspace level, update the workspace
   *   - else update the User (Global) scope
   *
   * Without this, "Hide rule colors" silently no-ops when a Workspace-level
   * `true` shadows our `Global` write.
   *
   * `ConfigurationTarget.WorkspaceFolder` is deliberately not a candidate.
   * The setting is window-scoped (it has no `scope` in package.json), so VS
   * Code never resolves a per-folder value for it, and updating that target on
   * a configuration obtained without a resource is rejected outright.
   */
  const setColorRulesInExplorer = async (enabled: boolean): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration("aiRules");
    const inspect = cfg.inspect<boolean>("colorRulesInExplorer");
    const target =
      inspect?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
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
    await refreshUi();
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
    await refreshCursorRulesPreservingState(rulesDir, await detectTestCommand(root));
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.cursor/rules/ai-rules/`."
    );
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  });

  register("aiRules.syncClineWorkspace", async () => {
    const roots = workspaceRoots();
    if (roots.length === 0) {
      throw new Error("Open a folder in VS Code first.");
    }
    for (const target of roots) {
      await syncBundledMdcsToClinerules(target, bundleDir, mdcs, await detectTestCommand(target));
    }
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.clinerules/ai-rules/`" +
        (roots.length > 1 ? ` in ${roots.length} folders.` : ".")
    );
    await refreshUi();
  });

  register("aiRules.syncOpencodeWorkspace", async () => {
    const roots = workspaceRoots();
    if (roots.length === 0) {
      throw new Error("Open a folder in VS Code first.");
    }
    let skipped = false;
    for (const target of roots) {
      const result = await syncRulePackToOpencode(
        target,
        bundleDir,
        mdcs,
        await detectTestCommand(target)
      );
      if (result === "skipped") {
        skipped = true;
      }
    }
    if (skipped) {
      vscode.window.showWarningMessage(
        'AI Rulebook: wrote the rule pack to `.opencode/rules/ai-rules/` but could not ' +
          "update the opencode config (unrecognized format). Add " +
          `"instructions": ["${OPENCODE_RULES_GLOB}"] to your opencode config manually.`
      );
    } else {
      vscode.window.showInformationMessage(
        "AI Rulebook: wrote the rule pack to `.opencode/rules/ai-rules/`" +
          (roots.length > 1 ? ` in ${roots.length} folders.` : ".")
      );
    }
    await refreshUi();
  });

  register("aiRules.syncClaudeWorkspace", async () => {
    const roots = workspaceRoots();
    if (roots.length === 0) {
      throw new Error("Open a folder in VS Code first.");
    }
    for (const target of roots) {
      await syncRulePackToClaude(target, bundleDir, mdcs, await detectTestCommand(target));
    }
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.claude/rules/ai-rules/`" +
        (roots.length > 1 ? ` in ${roots.length} folders.` : ".")
    );
    await refreshUi();
  });

  register("aiRules.syncWindsurfWorkspace", async () => {
    const roots = workspaceRoots();
    if (roots.length === 0) {
      throw new Error("Open a folder in VS Code first.");
    }
    for (const target of roots) {
      await syncRulePackToWindsurf(target, bundleDir, mdcs, await detectTestCommand(target));
    }
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.windsurf/rules/ai-rules/`" +
        (roots.length > 1 ? ` in ${roots.length} folders.` : ".")
    );
    await refreshUi();
  });

  register("aiRules.syncCopilotWorkspace", async () => {
    const roots = workspaceRoots();
    if (roots.length === 0) {
      throw new Error("Open a folder in VS Code first.");
    }
    for (const target of roots) {
      await syncRulePackToCopilot(target, bundleDir, mdcs, await detectTestCommand(target));
    }
    vscode.window.showInformationMessage(
      "AI Rulebook: wrote the rule pack to `.github/instructions/ai-rules/`" +
        (roots.length > 1 ? ` in ${roots.length} folders.` : ".")
    );
    await refreshUi();
  });

  /**
   * Writes every supported format in one step. The `.cursor/` install applies
   * to the first workspace folder only (the sidebar toggles read that folder),
   * while the Cline / opencode / Claude Code / Windsurf / Copilot mirrors are
   * written in every open folder, matching the per-format sync commands.
   */
  register("aiRules.syncAllFormatsWorkspace", async () => {
    const roots = ensureWorkspaces();
    if (!(await pathExists(bundleDir))) {
      throw new Error(`Missing bundle at ${bundleDir}`);
    }
    const rulesDir = workspaceRulesDir(roots[0]);
    await refreshCursorRulesPreservingState(rulesDir, await detectTestCommand(roots[0]));

    let opencodeSkipped = false;
    for (const target of roots) {
      const testCommand = await detectTestCommand(target);
      await syncBundledMdcsToClinerules(target, bundleDir, mdcs, testCommand);
      if ((await syncRulePackToOpencode(target, bundleDir, mdcs, testCommand)) === "skipped") {
        opencodeSkipped = true;
      }
      await syncRulePackToClaude(target, bundleDir, mdcs, testCommand);
      await syncRulePackToWindsurf(target, bundleDir, mdcs, testCommand);
      await syncRulePackToCopilot(target, bundleDir, mdcs, testCommand);
    }

    vscode.window.showInformationMessage(
      "AI Rulebook: synced the rule pack to `.cursor/rules/ai-rules/`, " +
        "`.clinerules/ai-rules/`, `.opencode/rules/ai-rules/`, `.claude/rules/ai-rules/`, " +
        "`.windsurf/rules/ai-rules/`, and `.github/instructions/ai-rules/`" +
        (roots.length > 1
          ? ` (Cursor in the first folder, the mirrors in all ${roots.length}).`
          : ".")
    );
    if (opencodeSkipped) {
      vscode.window.showWarningMessage(
        'AI Rulebook: wrote the opencode rule files but could not update the opencode config ' +
          "(unrecognized format). Add " +
          `"instructions": ["${OPENCODE_RULES_GLOB}"] to your opencode config manually.`
      );
    }
    await showRulePackStatusInOutput(rulesOutput, rulesDir, mdcs);
    await refreshUi();
  });

  const confirmDestructive = async (message: string, action: string): Promise<boolean> => {
    const roots = workspaceRoots();
    const scope =
      roots.length > 1 ? `\n\nThis applies to all ${roots.length} open workspace folders.` : "";
    const choice = await vscode.window.showWarningMessage(
      `${message}${scope}`,
      { modal: true },
      action,
      "Cancel"
    );
    return choice === action;
  };

  const formatRemovalMessage = (removed: boolean, label: string): string =>
    removed ? `${label}: removed.` : `${label}: nothing to remove.`;

  /**
   * Runs a per-folder removal in every open workspace folder and reports
   * whether anything was removed anywhere. Remove commands mirror the sync
   * commands, which write into every folder—removing only the first one leaves
   * rule packs behind while reporting success.
   */
  const removeInEveryFolder = async (
    remove: (root: string) => Promise<boolean>
  ): Promise<boolean> => {
    let removed = false;
    for (const root of ensureWorkspaces()) {
      if (await remove(root)) {
        removed = true;
      }
    }
    return removed;
  };

  register("aiRules.removeCursorWorkspace", async () => {
    ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove the Cursor rule pack from `.cursor/rules/ai-rules/`?\n\n" +
        "Unsaved or uncommitted edits in that folder may be lost.",
      "Remove Cursor rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeInEveryFolder(removeCursorRules);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Cursor")}`
    );
    await refreshUi();
  });

  register("aiRules.removeClineWorkspace", async () => {
    ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove the Cline rule pack from `.clinerules/ai-rules/`?",
      "Remove Cline rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeInEveryFolder(removeClineRules);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Cline")}`
    );
    await refreshUi();
  });

  register("aiRules.removeOpencodeWorkspace", async () => {
    ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove the opencode rule pack from `.opencode/rules/ai-rules/`?\n\n" +
        "The opencode config `instructions` entry is not edited automatically.",
      "Remove opencode rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeInEveryFolder(async (root) => {
      const dirRemoved = await removeOpencodeRules(root);
      await removeOpencodeCommandFile(root);
      return dirRemoved;
    });
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "opencode")}`
    );
    await refreshUi();
  });

  register("aiRules.removeClaudeWorkspace", async () => {
    ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove the Claude Code rule pack from `.claude/rules/ai-rules/`?",
      "Remove Claude Code rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeInEveryFolder(removeClaudeRules);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Claude Code")}`
    );
    await refreshUi();
  });

  register("aiRules.removeWindsurfWorkspace", async () => {
    ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove the Windsurf rule pack from `.windsurf/rules/ai-rules/`?",
      "Remove Windsurf rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeInEveryFolder(removeWindsurfRules);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "Windsurf")}`
    );
    await refreshUi();
  });

  register("aiRules.removeCopilotWorkspace", async () => {
    ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove the GitHub Copilot rule pack from `.github/instructions/ai-rules/`?",
      "Remove GitHub Copilot rules"
    );
    if (!confirmed) {
      return;
    }
    const removed = await removeInEveryFolder(removeCopilotRules);
    vscode.window.showInformationMessage(
      `AI Rulebook: ${formatRemovalMessage(removed, "GitHub Copilot")}`
    );
    await refreshUi();
  });

  register("aiRules.removeAllFormatsWorkspace", async () => {
    const roots = ensureWorkspaces();
    const confirmed = await confirmDestructive(
      "Remove every AI Rulebook rule pack from this workspace?\n\n" +
        "• `.cursor/rules/ai-rules/`\n" +
        "• `.clinerules/ai-rules/`\n" +
        "• `.opencode/rules/ai-rules/`\n" +
        "• `.claude/rules/ai-rules/`\n" +
        "• `.windsurf/rules/ai-rules/`\n" +
        "• `.github/instructions/ai-rules/`\n\n" +
        "Unsaved or uncommitted edits may be lost.",
      "Remove all rule packs"
    );
    if (!confirmed) {
      return;
    }
    const removed = {
      cursor: false,
      cline: false,
      opencode: false,
      claude: false,
      windsurf: false,
      copilot: false,
    };
    for (const root of roots) {
      const result = await removeAllRuleFormats(root);
      await removeOpencodeCommandFile(root);
      removed.cursor ||= result.cursor;
      removed.cline ||= result.cline;
      removed.opencode ||= result.opencode;
      removed.claude ||= result.claude;
      removed.windsurf ||= result.windsurf;
      removed.copilot ||= result.copilot;
    }
    const parts = [
      formatRemovalMessage(removed.cursor, "Cursor"),
      formatRemovalMessage(removed.cline, "Cline"),
      formatRemovalMessage(removed.opencode, "opencode"),
      formatRemovalMessage(removed.claude, "Claude Code"),
      formatRemovalMessage(removed.windsurf, "Windsurf"),
      formatRemovalMessage(removed.copilot, "GitHub Copilot"),
    ];
    vscode.window.showInformationMessage(`AI Rulebook: ${parts.join(" ")}`);
    await refreshUi();
  });

  register("aiRules.refreshTree", async () => {
    await refreshUi();
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
    const clineSynced = await maybeAutoSyncCline();
    const opencodeSynced = await maybeAutoSyncOpencode();
    const claudeSynced = await maybeAutoSyncClaude();
    const windsurfSynced = await maybeAutoSyncWindsurf();
    const copilotSynced = await maybeAutoSyncCopilot();
    vscode.window.showInformationMessage(
      "AI Rulebook: workspace rules folder reset to defaults." +
        (clineSynced ? " Cline: synced to `.clinerules/ai-rules/`." : "") +
        (opencodeSynced ? " opencode: synced to `.opencode/rules/ai-rules/`." : "") +
        (claudeSynced ? " Claude Code: synced to `.claude/rules/ai-rules/`." : "") +
        (windsurfSynced ? " Windsurf: synced to `.windsurf/rules/ai-rules/`." : "") +
        (copilotSynced ? " GitHub Copilot: synced to `.github/instructions/ai-rules/`." : "")
    );
    await showRulePackStatusInOutput(rulesOutput, workspaceRulesDir(root), mdcs);
    await refreshUi();
  });

  await autoInstallIfMissing();
  await updateStatusBar();

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
