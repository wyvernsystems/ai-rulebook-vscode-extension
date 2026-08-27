import * as vscode from "vscode";
import {
  syncBundledMdcsToClaudeRules,
  workspaceUsesClaudeCode,
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
 * Whether the automatic Claude Code sync should run for this workspace: the
 * `aiRules.autoSyncClaudeWhenInstalled` setting is on and the workspace shows
 * evidence of Claude Code usage (a `CLAUDE.md`, a `CLAUDE.local.md`, or a
 * `.claude/` directory). Manual commands ignore this gate.
 */
export async function shouldAutoSyncClaude(workspaceRoot: string): Promise<boolean> {
  if (!getAiRulesBoolean("autoSyncClaudeWhenInstalled", true)) {
    return false;
  }
  return workspaceUsesClaudeCode(workspaceRoot);
}

/**
 * Mirrors the bundled rule pack for Claude Code: writes stripped `.md`
 * copies into `.claude/rules/ai-rules/`. Claude Code auto-discovers every
 * `.md` file under `.claude/rules/`, so no config file registration is
 * needed (unlike opencode's `instructions` array).
 */
export async function syncRulePackToClaude(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  await syncBundledMdcsToClaudeRules(workspaceRoot, bundleDir, ruleFiles, testCommand);
}
