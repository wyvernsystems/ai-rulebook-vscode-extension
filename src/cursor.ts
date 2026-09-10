import * as vscode from "vscode";

/**
 * Detects whether the host application is Cursor (vs vanilla VS Code,
 * VSCodium, etc.). Two signals are checked because both have been observed
 * across Cursor builds:
 *
 *   - `vscode.env.uriScheme` is `"cursor"` in Cursor and `"vscode"` /
 *     `"vscodium"` elsewhere. This is set at IDE-build time and is the
 *     most reliable signal.
 *   - `vscode.env.appName` typically reads `"Cursor"` (or
 *     `"Cursor - Insiders"` / similar) in Cursor builds.
 *
 * A Cursor host counts as evidence that the workspace is used with an AI
 * agent, so auto-install on open runs even before any agent file exists.
 */
export function isCursorHost(): boolean {
  if (vscode.env.uriScheme === "cursor") {
    return true;
  }
  return vscode.env.appName.toLowerCase().includes("cursor");
}
