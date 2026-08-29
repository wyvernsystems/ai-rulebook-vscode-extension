import * as vscode from "vscode";
import {
  isRuleEnabled,
  setRuleEnabled,
  workspaceRulesDir,
} from "./rulesOperations";
import { UI_COLORS } from "./uiPresentation";

/** ID must match the view contributed in package.json. */
export const RULES_TREE_VIEW_ID = "aiRules.rulesTree";

/**
 * Synthetic URI scheme used to attach decoration state to rule TreeItems.
 * The path is `/on/<rule-path>` for active rules and `/off/<rule-path>` for
 * disabled ones, so the FileDecorationProvider can look at the path alone.
 */
const RULE_STATUS_SCHEME = "ai-rules-status";

type RuleItem = {
  kind: "rule";
  ruleFile: string; // forward-slash relative path from manifest
};

type Node = RuleItem;

function ruleStatusUri(ruleFile: string, enabled: boolean): vscode.Uri {
  return vscode.Uri.from({
    scheme: RULE_STATUS_SCHEME,
    path: `/${enabled ? "on" : "off"}/${ruleFile}`,
  });
}

/**
 * Colors rule labels in the sidebar tree:
 *   - active rules → AI Rulebook's theme-aware success color
 *   - disabled rules → AI Rulebook's theme-aware inactive color
 * Stateless: the URI path encodes the on/off state, so refreshing the tree
 * (which rebuilds resource URIs) updates colors without provider state.
 */
export class RuleStatusDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== RULE_STATUS_SCHEME) {
      return undefined;
    }
    if (uri.path.startsWith("/on/")) {
      return {
        color: new vscode.ThemeColor(UI_COLORS.active),
        tooltip: "Enabled — loaded by Cursor",
      };
    }
    if (uri.path.startsWith("/off/")) {
      return {
        color: new vscode.ThemeColor(UI_COLORS.inactive),
        tooltip: "Disabled — not loaded by Cursor",
      };
    }
    return undefined;
  }
}

/**
 * Tree data provider for the bundled rule pack.
 */
export class RulesTreeProvider implements vscode.TreeDataProvider<Node> {
  constructor(private readonly ruleFiles: readonly string[]) {}

  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  /**
   * Callbacks fired after every tree refresh. Lets sibling decoration
   * providers (sidebar colors, Explorer colors) re-publish without each
   * call site having to know about them.
   */
  private readonly afterRefresh: Array<() => void> = [];

  onAfterRefresh(cb: () => void): void {
    this.afterRefresh.push(cb);
  }

  refresh(): void {
    this._onDidChange.fire(undefined);
    for (const cb of this.afterRefresh) {
      cb();
    }
  }

  getTreeItem(node: Node): Promise<vscode.TreeItem> {
    return this.ruleTreeItem(node);
  }

  getChildren(parent?: Node): Promise<Node[]> {
    if (!parent) {
      if (!vscode.workspace.workspaceFolders?.length) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        this.ruleFiles.map((ruleFile) => ({ kind: "rule", ruleFile }))
      );
    }
    return Promise.resolve([]);
  }

  private async ruleTreeItem(node: RuleItem): Promise<vscode.TreeItem> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const enabled = root ? await isRuleEnabled(workspaceRulesDir(root), node.ruleFile) : false;
    const label = node.ruleFile
      .replace(/\.mdc$/, "")
      .split(/[-_/]/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ");
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = enabled ? "Enabled" : "Disabled";
    item.tooltip =
      `${label} · ${enabled ? "Enabled" : "Disabled"}\n${node.ruleFile}\n\n` +
      "Use the checkbox to change its status. Select the name to open the rule.";
    item.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.iconPath = new vscode.ThemeIcon(
      enabled ? "pass-filled" : "circle-outline",
      new vscode.ThemeColor(enabled ? UI_COLORS.active : UI_COLORS.inactive)
    );
    item.resourceUri = ruleStatusUri(node.ruleFile, enabled);
    item.accessibilityInformation = {
      label: `${label}, ${enabled ? "enabled" : "disabled"}`,
      role: "checkbox",
    };
    item.command = {
      command: "aiRules.revealRuleFile",
      title: "Open rule file",
      arguments: [node.ruleFile],
    };
    return item;
  }

}

/**
 * Wires the tree view to checkbox events: a single click on a checkbox flips
 * the rule's `.mdc` ↔ `.mdc.disabled` rename. A workspace must be open—if not,
 * we surface a friendly hint instead of silently failing.
 *
 * `onRuleToggle` (optional) is invoked after every successful toggle with the
 * rule file and its new state. It lets the caller propagate the change to
 * mirrors (Cline / opencode / Claude Code, across every workspace folder)
 * without this module knowing about them.
 */
export function bindRulesTreeView(
  context: vscode.ExtensionContext,
  provider: RulesTreeProvider,
  afterChange: () => Promise<void>,
  onRuleToggle?: (ruleFile: string, enabled: boolean) => Promise<void>
): vscode.TreeView<Node> {
  const view = vscode.window.createTreeView<Node>(RULES_TREE_VIEW_ID, {
    treeDataProvider: provider,
    canSelectMany: false,
  });

  view.onDidChangeCheckboxState(async (e) => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showWarningMessage("AI Rulebook: open a folder before toggling rules.");
      provider.refresh();
      return;
    }
    const rulesDir = workspaceRulesDir(root);
    for (const [node, state] of e.items) {
      const enable = state === vscode.TreeItemCheckboxState.Checked;
      try {
        await setRuleEnabled(rulesDir, node.ruleFile, enable);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`AI Rulebook: ${node.ruleFile} — ${msg}`);
        continue;
      }
      if (onRuleToggle) {
        try {
          await onRuleToggle(node.ruleFile, enable);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `AI Rulebook: mirror sync for ${node.ruleFile} — ${msg}`
          );
        }
      }
    }
    await afterChange();
    provider.refresh();
  });

  context.subscriptions.push(view);
  return view;
}
