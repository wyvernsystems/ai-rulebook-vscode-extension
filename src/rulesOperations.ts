import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertSafeDeletionTarget } from "./safePaths";

/**
 * Project test command substituted into rule text at write time, or `null`
 * when the workspace gives no clear signal. Threaded explicitly through every
 * function that turns bundled rule text into workspace rule text.
 */
export type TestCommand = string | null;

const RULES_SUBDIR = "ai-rules";

/**
 * Folders earlier releases generated per tool. The rule pack now lives in
 * `AGENTS.md` (see `agentsMd.ts`); these helpers only exist so a workspace
 * upgraded from that layout can clean up.
 */
const CURSOR_RULES_DIR_SEGMENTS = [".cursor", "rules", RULES_SUBDIR] as const;
const CLINE_RULES_DIR_SEGMENTS = [".clinerules", RULES_SUBDIR] as const;
const OPENCODE_RULES_DIR_SEGMENTS = [".opencode", "rules", RULES_SUBDIR] as const;
const OPENCODE_COMMAND_FILE_SEGMENTS = [".opencode", "command", "ai-rulebook.md"] as const;
const CLAUDE_RULES_DIR_SEGMENTS = [".claude", "rules", RULES_SUBDIR] as const;
const WINDSURF_RULES_DIR_SEGMENTS = [".windsurf", "rules", RULES_SUBDIR] as const;
const COPILOT_RULES_DIR_SEGMENTS = [".github", "instructions", RULES_SUBDIR] as const;

/**
 * Files and folders that show a workspace is already used with an AI coding
 * agent. Auto-install on open only runs when one of these exists (or the
 * host itself is an agent IDE), so the extension never drops an `AGENTS.md`
 * into a project that has no use for it.
 */
const AGENT_EVIDENCE_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  ".claude",
  ".cursor",
  ".cursorrules",
  ".clinerules",
  ".opencode",
  "opencode.json",
  "opencode.jsonc",
  ".windsurf",
  ".windsurfrules",
  path.join(".github", "copilot-instructions.md"),
  path.join(".github", "instructions"),
] as const;

export type LegacyFolderRemovalResult = {
  cursor: boolean;
  cline: boolean;
  opencode: boolean;
  claude: boolean;
  windsurf: boolean;
  copilot: boolean;
};

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a leading Cursor YAML frontmatter block (`---` ... `---`), returning
 * the body unchanged when the file does not start with frontmatter. Line
 * endings in a stripped body are normalized to `\n`; the rendered text is
 * regenerated rather than user-edited, so this is intentional.
 */
export function stripCursorFrontmatter(body: string): string {
  const firstBreak = body.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? body : body.slice(0, firstBreak);
  if (firstLine.trim() !== "---") {
    return body;
  }
  const lines = body.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return body;
}

export async function workspaceShowsAgentEvidence(workspaceRoot: string): Promise<boolean> {
  for (const rel of AGENT_EVIDENCE_PATHS) {
    if (await pathExists(path.join(workspaceRoot, rel))) {
      return true;
    }
  }
  return false;
}

async function removeIfPresent(
  workspaceRoot: string,
  segments: readonly string[],
  label: string
): Promise<boolean> {
  const target = path.join(workspaceRoot, ...segments);
  if (!(await pathExists(target))) {
    return false;
  }
  assertSafeDeletionTarget(target, segments, label);
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to remove ${label} at ${target}: ${reason}`);
  }
  return true;
}

/** Deletes `.cursor/rules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeCursorRules(workspaceRoot: string): Promise<boolean> {
  return removeIfPresent(workspaceRoot, CURSOR_RULES_DIR_SEGMENTS, "Cursor rules folder");
}

/** Deletes `.clinerules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeClineRules(workspaceRoot: string): Promise<boolean> {
  return removeIfPresent(workspaceRoot, CLINE_RULES_DIR_SEGMENTS, "Cline rules folder");
}

/**
 * Deletes `.opencode/rules/ai-rules/` and the `.opencode/command/ai-rulebook.md`
 * slash command when present. Returns whether anything was removed.
 */
export async function removeOpencodeRules(workspaceRoot: string): Promise<boolean> {
  const rules = await removeIfPresent(
    workspaceRoot,
    OPENCODE_RULES_DIR_SEGMENTS,
    "opencode rules folder"
  );
  const command = await removeIfPresent(
    workspaceRoot,
    OPENCODE_COMMAND_FILE_SEGMENTS,
    "opencode command file"
  );
  return rules || command;
}

/** Deletes `.claude/rules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeClaudeRules(workspaceRoot: string): Promise<boolean> {
  return removeIfPresent(workspaceRoot, CLAUDE_RULES_DIR_SEGMENTS, "Claude Code rules folder");
}

/** Deletes `.windsurf/rules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeWindsurfRules(workspaceRoot: string): Promise<boolean> {
  return removeIfPresent(workspaceRoot, WINDSURF_RULES_DIR_SEGMENTS, "Windsurf rules folder");
}

/** Deletes `.github/instructions/ai-rules/` when present. Returns whether anything was removed. */
export async function removeCopilotRules(workspaceRoot: string): Promise<boolean> {
  return removeIfPresent(
    workspaceRoot,
    COPILOT_RULES_DIR_SEGMENTS,
    "GitHub Copilot instructions folder"
  );
}

/** Deletes every per-tool rule folder an earlier release generated. */
export async function removeLegacyRuleFolders(
  workspaceRoot: string
): Promise<LegacyFolderRemovalResult> {
  return {
    cursor: await removeCursorRules(workspaceRoot),
    cline: await removeClineRules(workspaceRoot),
    opencode: await removeOpencodeRules(workspaceRoot),
    claude: await removeClaudeRules(workspaceRoot),
    windsurf: await removeWindsurfRules(workspaceRoot),
    copilot: await removeCopilotRules(workspaceRoot),
  };
}
