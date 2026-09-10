import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Claude Code reads `CLAUDE.md`, not `AGENTS.md`. Its `@path` import syntax
 * lets one line pull the shared file in, so the rule pack only ever lives in
 * `AGENTS.md` (see `agentsMd.ts`). Imports are not evaluated inside code
 * fences or inline code, so those mentions do not count as an import here.
 */

export const CLAUDE_MD = "CLAUDE.md";
export const AGENTS_MD_IMPORT = "@AGENTS.md";

const IMPORT_PATTERN = /(^|[\s(])@AGENTS\.md(?=$|[\s),;:]|\.(?=\s|$))/;

export type EnsureImportResult = "created" | "added" | "unchanged";

export function claudeMdPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CLAUDE_MD);
}

/** Line indexes outside fenced code, shared by import detection and removal. */
function* unfencedLineIndexes(lines: readonly string[]): Generator<number> {
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(rawLine);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
      } else if (
        marker[0] === fence[0] && marker.length >= fence.length &&
        rawLine.slice(fenceMatch[0].length).trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fence === null) {
      yield index;
    }
  }
}

/** True when `text` imports AGENTS.md somewhere Claude Code would honor it. */
export function claudeMdImportsAgentsMd(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (const index of unfencedLineIndexes(lines)) {
    const rawLine = lines[index];
    const withoutInlineCode = rawLine.replace(/`[^`]*`/g, " ");
    if (IMPORT_PATTERN.test(withoutInlineCode)) {
      return true;
    }
  }
  return false;
}

async function readClaudeMd(workspaceRoot: string): Promise<string | null> {
  try {
    return await fs.readFile(claudeMdPath(workspaceRoot), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read ${CLAUDE_MD}: ${reason}`, { cause: e });
  }
}

async function writeClaudeMd(workspaceRoot: string, text: string): Promise<void> {
  try {
    await fs.writeFile(claudeMdPath(workspaceRoot), text, "utf8");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to write ${CLAUDE_MD}: ${reason}`, { cause: e });
  }
}

/** Creates `CLAUDE.md` or appends the import line to one that lacks it. */
export async function ensureAgentsMdImport(workspaceRoot: string): Promise<EnsureImportResult> {
  const existing = await readClaudeMd(workspaceRoot);
  if (existing === null) {
    await writeClaudeMd(workspaceRoot, `${AGENTS_MD_IMPORT}\n`);
    return "created";
  }
  if (claudeMdImportsAgentsMd(existing)) {
    return "unchanged";
  }
  if (existing.trim() === "") {
    await writeClaudeMd(workspaceRoot, `${AGENTS_MD_IMPORT}\n`);
    return "added";
  }
  const trailing = existing.endsWith("\n") ? "" : "\n";
  await writeClaudeMd(workspaceRoot, `${existing}${trailing}\n${AGENTS_MD_IMPORT}\n`);
  return "added";
}

/**
 * Removes whole lines that hold only the import. Inline mentions stay: the
 * user wrote those sentences. Deletes the file when nothing else remains.
 */
export async function removeAgentsMdImport(
  workspaceRoot: string
): Promise<{ removed: boolean; deletedFile: boolean }> {
  const existing = await readClaudeMd(workspaceRoot);
  if (existing === null) {
    return { removed: false, deletedFile: false };
  }
  const lines = existing.split("\n");
  const unfenced = new Set(unfencedLineIndexes(lines));
  const kept: string[] = [];
  let removedCount = 0;
  for (const [index, line] of lines.entries()) {
    if (unfenced.has(index) && line.replace(/\r$/, "").trim() === AGENTS_MD_IMPORT) {
      removedCount += 1;
      // Drop the blank line that separated the import from what came before,
      // so removing "\n@AGENTS.md\n" leaves no double gap behind.
      const prev = kept[kept.length - 1];
      if (prev !== undefined && prev.trim() === "" && kept.length > 1) {
        kept.pop();
      }
      continue;
    }
    kept.push(line);
  }
  if (removedCount === 0) {
    return { removed: false, deletedFile: false };
  }
  const remainder = kept.join("\n");
  if (remainder.trim() === "") {
    await fs.rm(claudeMdPath(workspaceRoot), { force: true });
    return { removed: true, deletedFile: true };
  }
  await writeClaudeMd(workspaceRoot, remainder.endsWith("\n") ? remainder : `${remainder}\n`);
  return { removed: true, deletedFile: false };
}
