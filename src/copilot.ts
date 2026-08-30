import * as vscode from "vscode";
import {
  syncBundledMdcsToCopilotRules,
  workspaceUsesCopilot,
  type TestCommand,
} from "./rulesOperations";

function getAiRulesBoolean(key: string, defaultValue: boolean): boolean {
  const v = vscode.workspace.getConfiguration("aiRules").get(key);
  if (typeof v === "boolean") {
    return v;
  }
  return defaultValue;
}

/**
 * Whether the automatic GitHub Copilot sync should run for this workspace:
 * the `aiRules.autoSyncCopilotWhenInstalled` setting is on and the workspace
 * shows evidence of Copilot custom-instructions usage (a
 * `.github/copilot-instructions.md` file or a `.github/instructions/`
 * directory). Manual commands ignore this gate.
 */
export async function shouldAutoSyncCopilot(workspaceRoot: string): Promise<boolean> {
  if (!getAiRulesBoolean("autoSyncCopilotWhenInstalled", true)) {
    return false;
  }
  return workspaceUsesCopilot(workspaceRoot);
}

/**
 * Mirrors the bundled rule pack for GitHub Copilot: writes converted
 * `.instructions.md` copies into `.github/instructions/ai-rules/`. Copilot
 * auto-discovers every `*.instructions.md` file under `.github/instructions/`,
 * so no config file registration is needed (unlike opencode's `instructions`
 * array).
 */
export async function syncRulePackToCopilot(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  await syncBundledMdcsToCopilotRules(workspaceRoot, bundleDir, ruleFiles, testCommand);
}
