import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  assertContainedPath,
  assertSafeDeletionTarget,
  isSafeManifestEntry,
} from "./safePaths";

const RULES_SUBDIR = "ai-rules";
export const CORE_RULE_FILE = "core.mdc";
export const GENERATED_RULE_IGNORE_ENTRIES = [
  "/.cursor/rules/ai-rules/",
  "/.clinerules/ai-rules/",
] as const;

const RULES_DIR_SEGMENTS = [".cursor", "rules", RULES_SUBDIR] as const;

export function workspaceRulesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".cursor", "rules", RULES_SUBDIR);
}

function normalizeIgnoreEntry(entry: string): string {
  return entry.trim().replace(/^\//, "").replace(/\/+$/, "");
}

/** Keeps generated Cursor and Cline rule folders out of source control. */
export async function ensureAiRulesIgnored(workspaceRoot: string): Promise<void> {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Unable to read ${gitignorePath}: ${String(error)}`);
    }
  }

  const ignored = new Set(
    existing
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map(normalizeIgnoreEntry)
  );
  const missing = GENERATED_RULE_IGNORE_ENTRIES.filter(
    (entry) => !ignored.has(normalizeIgnoreEntry(entry))
  );
  if (missing.length === 0) {
    return;
  }

  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const separator = existing.length > 0 && !existing.endsWith("\n") ? newline : "";
  await fs.writeFile(
    gitignorePath,
    `${existing}${separator}${missing.join(newline)}${newline}`,
    "utf8"
  );
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves `entry` under `base` after rejecting unsafe shapes (traversal,
 * absolute paths, suspicious characters) and confirming the resolved path
 * stays inside `base`.
 */
function safeJoinUnderBase(base: string, entry: string, label: string): string {
  if (!isSafeManifestEntry(entry)) {
    throw new Error(`Refusing unsafe rule path: ${entry}`);
  }
  const resolved = path.join(base, entry);
  assertContainedPath(base, resolved, label);
  return resolved;
}

/**
 * Recursive copy that refuses to follow symlinks. The bundled folder shipped
 * inside the VSIX should never contain symlinks, but a tampered install could,
 * so we filter them out by lstat before each entry is copied.
 */
async function copyTreeWithoutSymlinks(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (entrySrc) => {
      try {
        return !fsSync.lstatSync(entrySrc).isSymbolicLink();
      } catch {
        return false;
      }
    },
  });
}

export async function isRuleEnabled(rulesDir: string, ruleFile: string): Promise<boolean> {
  const target = safeJoinUnderBase(rulesDir, ruleFile, "rules directory");
  return pathExists(target);
}

export async function setRuleEnabled(
  rulesDir: string,
  ruleFile: string,
  enabled: boolean
): Promise<void> {
  const active = safeJoinUnderBase(rulesDir, ruleFile, "rules directory");
  const dis = `${active}.disabled`;
  if (enabled) {
    if (await pathExists(dis)) {
      if (await pathExists(active)) {
        await fs.rm(dis, { force: true });
      } else {
        await fs.mkdir(path.dirname(active), { recursive: true });
        await fs.rename(dis, active);
      }
    }
    return;
  }
  if (await pathExists(active)) {
    if (await pathExists(dis)) {
      await fs.rm(dis, { force: true });
    }
    await fs.mkdir(path.dirname(dis), { recursive: true });
    await fs.rename(active, dis);
  }
}

async function bundledCoreRulePath(bundleDir: string): Promise<string> {
  const core = safeJoinUnderBase(bundleDir, CORE_RULE_FILE, "bundle directory");
  if (!(await pathExists(core))) {
    throw new Error(`Bundled core rule missing: ${CORE_RULE_FILE}`);
  }
  return core;
}

/** Installs the active core rule while preserving unrelated workspace files. */
export async function installCoreRule(
  bundleDir: string,
  rulesDir: string
): Promise<void> {
  const src = await bundledCoreRulePath(bundleDir);
  const dest = safeJoinUnderBase(rulesDir, CORE_RULE_FILE, "rules directory");
  await fs.mkdir(rulesDir, { recursive: true });
  await fs.rm(`${dest}.disabled`, { force: true });
  await fs.copyFile(src, dest);
}

export async function resetRulesDirToBundle(
  bundleDir: string,
  rulesDir: string
): Promise<void> {
  assertSafeDeletionTarget(rulesDir, RULES_DIR_SEGMENTS, "workspace rules folder");
  await fs.mkdir(path.dirname(rulesDir), { recursive: true });
  await fs.rm(rulesDir, { recursive: true, force: true });
  await copyTreeWithoutSymlinks(bundleDir, rulesDir);
}

export async function syncBundledMdcsToClinerules(
  workspaceRoot: string,
  bundleDir: string
): Promise<void> {
  await ensureAiRulesIgnored(workspaceRoot);
  const dest = path.join(workspaceRoot, ".clinerules", RULES_SUBDIR);
  await fs.mkdir(dest, { recursive: true });
  const srcPath = await bundledCoreRulePath(bundleDir);
  const destPath = path.join(dest, "ai-rules-core.md");
  assertContainedPath(dest, destPath, "Cline rules directory");
  const body = await fs.readFile(srcPath, "utf8");
  await fs.writeFile(destPath, body, "utf8");
}
