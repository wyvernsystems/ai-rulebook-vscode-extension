import * as vscode from "vscode";

/** Stable Cline + nightly extension IDs (see VS Code Marketplace). */
const CLINE_EXTENSION_IDS = ["saoudrizwan.claude-dev", "saoudrizwan.cline-nightly"] as const;

export function isClineInstalled(): boolean {
  return CLINE_EXTENSION_IDS.some((id) => !!vscode.extensions.getExtension(id));
}
