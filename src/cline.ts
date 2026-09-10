import * as vscode from "vscode";

/** Stable Cline + nightly extension IDs (see VS Code Marketplace). */
const CLINE_EXTENSION_IDS = ["saoudrizwan.claude-dev", "saoudrizwan.cline-nightly"] as const;

/**
 * An installed Cline extension counts as evidence that the workspace is used
 * with an AI agent, so auto-install on open runs even before any agent file
 * exists. Cline reads `AGENTS.md` directly.
 */
export function isClineInstalled(): boolean {
  return CLINE_EXTENSION_IDS.some((id) => !!vscode.extensions.getExtension(id));
}
