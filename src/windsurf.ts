import * as vscode from "vscode";
import {
  syncBundledMdcsToWindsurfRules,
  workspaceUsesWindsurf,
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
 * Whether the automatic Windsurf sync should run for this workspace: the
 * `aiRules.autoSyncWindsurfWhenInstalled` setting is on and the workspace
 * shows evidence of Windsurf usage (a `.windsurf/` directory or a
 * `.windsurfrules` file). Manual commands ignore this gate.
 */
export async function shouldAutoSyncWindsurf(workspaceRoot: string): Promise<boolean> {
  if (!getAiRulesBoolean("autoSyncWindsurfWhenInstalled", true)) {
    return false;
  }
  return workspaceUsesWindsurf(workspaceRoot);
}

/**
 * Mirrors the bundled rule pack for Windsurf: writes converted `.md` copies
 * into `.windsurf/rules/ai-rules/`. Windsurf auto-discovers every `.md` file
 * under `.windsurf/rules/`, so no config file registration is needed (unlike
 * opencode's `instructions` array).
 */
export async function syncRulePackToWindsurf(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  await syncBundledMdcsToWindsurfRules(workspaceRoot, bundleDir, ruleFiles, testCommand);
}
