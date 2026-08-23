import * as path from "node:path";
import * as vscode from "vscode";
import { UI_COLORS } from "./uiPresentation";

const CURSOR_RULES_SEGMENT = `${path.sep}.cursor${path.sep}rules${path.sep}ai-rules${path.sep}`;
const OPENCODE_RULES_SEGMENT = `${path.sep}.opencode${path.sep}rules${path.sep}ai-rules${path.sep}`;

const SETTING_ID = "colorRulesInExplorer";

function isEnabled(): boolean {
  const v = vscode.workspace.getConfiguration("aiRules").get(SETTING_ID);
  return typeof v === "boolean" ? v : true;
}

/**
 * Tints rule files green / red in the workbench Explorer (and any other view
 * that shows real `file://` URIs) based on whether they live as an active
 * (`<name>.mdc` / `<name>.md`) or disabled (`<name>.mdc.disabled` /
 * `<name>.md.disabled`) rule under any workspace's `.cursor/rules/ai-rules/`
 * or `.opencode/rules/ai-rules/` folder. Sibling to the sidebar tree's
 * `RuleStatusDecorationProvider`, which works on synthetic URIs—this one
 * works on the actual files on disk so the same colors show up in the
 * project's file tree.
 *
 * Gated by `aiRules.colorRulesInExplorer` (default `true`). Toggling the
 * setting refreshes all decorations so colors appear / disappear without a
 * reload.
 */
export class WorkspaceRuleFileColorer implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** Invalidate decorations for the given URIs, or all decorations if none given. */
  refresh(uris?: vscode.Uri[]): void {
    this._onDidChange.fire(uris ?? undefined);
  }

  private static ownerFor(fsPath: string): "Cursor" | "opencode" | undefined {
    if (fsPath.includes(CURSOR_RULES_SEGMENT)) {
      return "Cursor";
    }
    if (fsPath.includes(OPENCODE_RULES_SEGMENT)) {
      return "opencode";
    }
    return undefined;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!isEnabled()) {
      return undefined;
    }
    if (uri.scheme !== "file") {
      return undefined;
    }
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      return undefined;
    }
    const fsPath = uri.fsPath;
    const owner = WorkspaceRuleFileColorer.ownerFor(fsPath);
    if (!owner) {
      return undefined;
    }
    const activeSuffix = owner === "Cursor" ? ".mdc" : ".md";
    if (fsPath.endsWith(activeSuffix)) {
      return {
        color: new vscode.ThemeColor(UI_COLORS.active),
        tooltip: `AI Rulebook — enabled and loaded by ${owner}`,
      };
    }
    if (fsPath.endsWith(`${activeSuffix}.disabled`)) {
      return {
        color: new vscode.ThemeColor(UI_COLORS.inactive),
        tooltip: `AI Rulebook — disabled and not loaded by ${owner}`,
      };
    }
    return undefined;
  }
}

export const COLOR_RULES_IN_EXPLORER_SETTING = `aiRules.${SETTING_ID}`;
