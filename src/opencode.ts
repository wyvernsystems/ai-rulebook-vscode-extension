import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  ensureOpencodeInstructionsEntry,
  opencodeConfigRegistersGlob,
  OPENCODE_RULES_GLOB,
  pathExists,
  resolveOpencodeConfigPath,
  syncBundledMdcsToOpencodeRules,
  workspaceOpencodeRulesDir,
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
 * Status of the opencode mirror for a workspace, read-only:
 *   - `"none"`: no opencode evidence or no mirror yet.
 *   - `"synced"`: rule folder exists and the config registers it.
 *   - `"skipped"`: rule folder exists but the config could not be updated.
 */
export type OpencodeSyncStatus = "none" | "synced" | "skipped";

export async function opencodeSyncStatus(workspaceRoot: string): Promise<OpencodeSyncStatus> {
  if (!(await workspaceUsesOpencode(workspaceRoot))) {
    return "none";
  }
  if (!(await pathExists(workspaceOpencodeRulesDir(workspaceRoot)))) {
    return "none";
  }
  const configPath = await resolveOpencodeConfigPath(workspaceRoot);
  if (await opencodeConfigRegistersGlob(configPath, OPENCODE_RULES_GLOB)) {
    return "synced";
  }
  return "skipped";
}

const OPENCODE_COMMAND_FILE = "ai-rulebook.md";

const OPENCODE_COMMAND_BODY = `---
description: List the active AI Rulebook rules and their state for this project.
---

Find the AI Rulebook rules in \`.opencode/rules/ai-rules/\`: files named
\`<topic>.md\` are active and files named \`<topic>.md.disabled\` are disabled.

List every AI Rulebook rule by filename with its state (active or disabled),
grouping active rules first, and end with the total count of active rules.
`;

/**
 * Mirrors the bundled rule pack for opencode: writes stripped `.md` copies
 * into `.opencode/rules/ai-rules/`, registers the folder via the
 * `instructions` array of the project's opencode config (creating the config
 * when absent), and adds a `/ai-rulebook` slash command that lists the active
 * rules.
 */
export async function syncRulePackToOpencode(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<OpencodeConfigMergeResult> {
  await syncBundledMdcsToOpencodeRules(workspaceRoot, bundleDir, ruleFiles, testCommand);
  const configPath = await resolveOpencodeConfigPath(workspaceRoot);
  const result = await ensureOpencodeInstructionsEntry(configPath, OPENCODE_RULES_GLOB);
  await writeOpencodeCommandFile(workspaceRoot);
  return result;
}

async function writeOpencodeCommandFile(workspaceRoot: string): Promise<void> {
  const dir = path.join(workspaceRoot, ".opencode", "command");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, OPENCODE_COMMAND_FILE), OPENCODE_COMMAND_BODY, "utf8");
}

/** Removes the `/ai-rulebook` command file written by {@link syncRulePackToOpencode}. */
export async function removeOpencodeCommandFile(workspaceRoot: string): Promise<void> {
  await fs.rm(path.join(workspaceRoot, ".opencode", "command", OPENCODE_COMMAND_FILE), {
    force: true,
  });
}
