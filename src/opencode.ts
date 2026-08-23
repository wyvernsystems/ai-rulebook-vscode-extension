import * as vscode from "vscode";
import {
  ensureAiRulesIgnored,
  ensureOpencodeInstructionsEntry,
  OPENCODE_RULES_GLOB,
  resolveOpencodeConfigPath,
  syncBundledMdcsToOpencodeRules,
  workspaceUsesOpencode,
  type OpencodeConfigMergeResult,
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
 * Whether the automatic opencode sync should run for this workspace: the
 * `aiRules.autoSyncOpencodeWhenInstalled` setting is on and the workspace
 * shows evidence of opencode usage (an `AGENTS.md`, an opencode config file,
 * or a `.opencode/` directory). Manual commands ignore this gate.
 */
export async function shouldAutoSyncOpencode(workspaceRoot: string): Promise<boolean> {
  if (!getAiRulesBoolean("autoSyncOpencodeWhenInstalled", true)) {
    return false;
  }
  return workspaceUsesOpencode(workspaceRoot);
}

/**
 * Mirrors the bundled rule pack for opencode: writes stripped `.md` copies
 * into `.opencode/rules/ai-rules/`, keeps the generated folder out of source
 * control, and registers the folder via the `instructions` array of the
 * project's opencode config (creating the config when absent).
 */
export async function syncRulePackToOpencode(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<OpencodeConfigMergeResult> {
  await ensureAiRulesIgnored(workspaceRoot);
  await syncBundledMdcsToOpencodeRules(workspaceRoot, bundleDir, ruleFiles, testCommand);
  const configPath = await resolveOpencodeConfigPath(workspaceRoot);
  return ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
}
