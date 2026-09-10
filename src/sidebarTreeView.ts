import * as vscode from "vscode";
import { AGENTS_MD, hasRulesBlock, isRuleEnabledInAgentsMd } from "./agentsMd";
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

/** Applies one sidebar toggle to the workspace; errors are shown to the user. */
export type RuleToggleHandler = (
  workspaceRoot: string,
  ruleFile: string,
  enabled: boolean
) => Promise<void>;

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
        tooltip: `Enabled — text present in ${AGENTS_MD}`,
      };
    }
    if (uri.path.startsWith("/off/")) {
      return {
        color: new vscode.ThemeColor(UI_COLORS.inactive),
        tooltip: `Disabled — text removed from ${AGENTS_MD}`,
      };
    }
    return undefined;
  }
}

/**
 * Tree data provider for the bundled rule pack. State is read from the first
 * workspace folder's `AGENTS.md`.
 */
export class RulesTreeProvider implements vscode.TreeDataProvider<Node> {
  constructor(private readonly ruleFiles: readonly string[]) {}

  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  /**
   * Callbacks fired after every tree refresh. Lets the sidebar decoration
   * provider re-publish without each call site having to know about it.
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
    let enabled = false;
    if (root) {
      try {
        enabled = await isRuleEnabledInAgentsMd(root, node.ruleFile);
      } catch {
        // A damaged block is reported by the extension on activation; here
        // the rule simply shows as off rather than breaking the whole tree.
        enabled = false;
      }
    }
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
      `Use the checkbox to change its status. Select the name to open its section in ${AGENTS_MD}.`;
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
      title: "Open rule section",
      arguments: [node.ruleFile],
    };
    return item;
  }
}

/**
 * Wires the tree view to checkbox events: a single click on a checkbox edits
 * that rule's section in `AGENTS.md` via `toggleRule`. A workspace must be
 * open and the rule pack must be installed in it—without either there is no
 * section to edit, so we surface a friendly hint instead of silently failing.
 */
export function bindRulesTreeView(
  context: vscode.ExtensionContext,
  provider: RulesTreeProvider,
  toggleRule: RuleToggleHandler,
  afterChange: () => Promise<void>
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
    if (!(await hasRulesBlock(root))) {
      vscode.window.showWarningMessage(
        `AI Rulebook: no rule pack in ${AGENTS_MD} yet — run "AI Rulebook: Install / update rule pack" first.`
      );
      provider.refresh();
      return;
    }
    for (const [node, state] of e.items) {
      const enable = state === vscode.TreeItemCheckboxState.Checked;
      try {
        await toggleRule(root, node.ruleFile, enable);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`AI Rulebook: ${node.ruleFile} — ${msg}`);
      }
    }
    await afterChange();
    provider.refresh();
  });

  context.subscriptions.push(view);
  return view;
}
