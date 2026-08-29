import * as vscode from "vscode";

/** Stable Cline + nightly extension IDs (see VS Code Marketplace). */
const CLINE_EXTENSION_IDS = ["saoudrizwan.claude-dev", "saoudrizwan.cline-nightly"] as const;

export function isClineInstalled(): boolean {
  return CLINE_EXTENSION_IDS.some((id) => !!vscode.extensions.getExtension(id));
}

function getAiRulesBoolean(key: string, defaultValue: boolean): boolean {
  const v = vscode.workspace.getConfiguration("aiRules").get(key);
  if (typeof v === "boolean") {
    return v;
  }
  return defaultValue;
}

/**
 * Whether the automatic Cline sync should run: the
 * `aiRules.autoSyncClineWhenInstalled` setting is on and the Cline extension
 * is installed. Manual commands ignore this gate. Unlike opencode and Claude
 * Code, Cline has no workspace-evidence files to check for.
 */
export function shouldAutoSyncCline(): boolean {
  return getAiRulesBoolean("autoSyncClineWhenInstalled", true) && isClineInstalled();
}
