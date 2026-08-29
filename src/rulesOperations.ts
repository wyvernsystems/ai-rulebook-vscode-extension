import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  assertContainedPath,
  assertSafeDeletionTarget,
  isSafeManifestEntry,
} from "./safePaths";
import { renderRuleBody } from "./testCommand";

/**
 * Project test command substituted into rule text at write time, or `null`
 * when the workspace gives no clear signal. Threaded explicitly through every
 * function that turns bundled rule text into workspace rule text.
 */
export type TestCommand = string | null;

const RULES_SUBDIR = "ai-rules";
const LEGACY_CORE_RULE_FILE = "core.mdc";
/** Glob registered in the project's opencode config `instructions` array. */
export const OPENCODE_RULES_GLOB = ".opencode/rules/ai-rules/*.md";

const RULES_DIR_SEGMENTS = [".cursor", "rules", RULES_SUBDIR] as const;
const CLINE_RULES_DIR_SEGMENTS = [".clinerules", RULES_SUBDIR] as const;
const OPENCODE_RULES_DIR_SEGMENTS = [".opencode", "rules", RULES_SUBDIR] as const;
const CLAUDE_RULES_DIR_SEGMENTS = [".claude", "rules", RULES_SUBDIR] as const;

export type RuleFormatRemovalResult = {
  cursor: boolean;
  cline: boolean;
  opencode: boolean;
  claude: boolean;
};

export function workspaceRulesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".cursor", "rules", RULES_SUBDIR);
}

/** Claude Code auto-discovers every `.md` file under `.claude/rules/`. */
export function workspaceClaudeRulesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".claude", "rules", RULES_SUBDIR);
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

async function bundledRulePath(bundleDir: string, ruleFile: string): Promise<string> {
  const source = safeJoinUnderBase(bundleDir, ruleFile, "bundle directory");
  if (!(await pathExists(source))) {
    throw new Error(`Bundled rule missing: ${ruleFile}`);
  }
  return source;
}

/** Installs every active bundled rule while preserving unrelated workspace files. */
export async function installRulePack(
  bundleDir: string,
  rulesDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  const copies = await Promise.all(
    ruleFiles.map(async (ruleFile) => ({
      source: await bundledRulePath(bundleDir, ruleFile),
      destination: safeJoinUnderBase(rulesDir, ruleFile, "rules directory"),
    }))
  );
  await fs.mkdir(rulesDir, { recursive: true });
  for (const { source, destination } of copies) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(`${destination}.disabled`, { force: true });
    const body = renderRuleBody(await fs.readFile(source, "utf8"), testCommand);
    await fs.writeFile(destination, body, "utf8");
  }
  const legacyCore = safeJoinUnderBase(rulesDir, LEGACY_CORE_RULE_FILE, "rules directory");
  await fs.rm(legacyCore, { force: true });
  await fs.rm(`${legacyCore}.disabled`, { force: true });
}

export async function resetRulesDirToBundle(
  bundleDir: string,
  rulesDir: string,
  testCommand: TestCommand
): Promise<void> {
  assertSafeDeletionTarget(rulesDir, RULES_DIR_SEGMENTS, "workspace rules folder");
  await fs.mkdir(path.dirname(rulesDir), { recursive: true });
  await fs.rm(rulesDir, { recursive: true, force: true });
  await copyTreeWithoutSymlinks(bundleDir, rulesDir);
  await renderRuleTree(rulesDir, testCommand);
}

/** Rewrites every rule file under `dir` in place with placeholders resolved. */
async function renderRuleTree(dir: string, testCommand: TestCommand): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await renderRuleTree(full, testCommand);
      continue;
    }
    if (!entry.isFile() || !/\.mdc(\.disabled)?$/.test(entry.name)) {
      continue;
    }
    const original = await fs.readFile(full, "utf8");
    const rendered = renderRuleBody(original, testCommand);
    if (rendered !== original) {
      await fs.writeFile(full, rendered, "utf8");
    }
  }
}

export function workspaceClineRulesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".clinerules", RULES_SUBDIR);
}

/** `foo/bar.mdc` -> `ai-rules-foo-bar.md`, Cline's flat mirror naming. */
function clineMirrorName(ruleFile: string): string {
  return `ai-rules-${ruleFile.slice(0, -".mdc".length).replaceAll("/", "-")}.md`;
}

/**
 * Mirrors each bundled rule into `.clinerules/ai-rules/` as
 * `ai-rules-<topic>.md`, keeping the Cursor frontmatter as-is. The mirror
 * reflects the workspace's Cursor rule state: enabled rules are written as
 * `ai-rules-<topic>.md`, disabled ones as `ai-rules-<topic>.md.disabled`
 * (Cline only reads `.md` files, so disabled mirrors are skipped). When the
 * workspace has no Cursor rules folder yet, every rule defaults to enabled.
 */
export async function syncBundledMdcsToClinerules(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  const cursorDir = workspaceRulesDir(workspaceRoot);
  const hasCursorRules = await pathExists(cursorDir);
  const dest = workspaceClineRulesDir(workspaceRoot);
  const mirrors = await Promise.all(
    ruleFiles.map(async (ruleFile) => {
      const source = await bundledRulePath(bundleDir, ruleFile);
      const enabled = hasCursorRules ? await isRuleEnabled(cursorDir, ruleFile) : true;
      return {
        body: renderRuleBody(await fs.readFile(source, "utf8"), testCommand),
        enabled,
        destination: safeJoinUnderBase(dest, clineMirrorName(ruleFile), "Cline rules directory"),
      };
    })
  );
  await fs.mkdir(dest, { recursive: true });
  for (const { body, enabled, destination } of mirrors) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await writeRuleMirror(destination, body, enabled);
  }
  await fs.rm(path.join(dest, "ai-rules-core.md"), { force: true });
  await fs.rm(path.join(dest, "ai-rules-core.md.disabled"), { force: true });
}

/**
 * Mirrors one rule into `.clinerules/ai-rules/` from the workspace's Cursor
 * rule file (`<topic>.mdc` when enabled, `<topic>.mdc.disabled` when off),
 * keeping the frontmatter as-is. Used to keep the Cline mirror in sync
 * immediately after a sidebar toggle or a single-rule enable/disable.
 */
export async function mirrorRuleToCline(
  workspaceRoot: string,
  ruleFile: string,
  enabled: boolean
): Promise<void> {
  const cursorActive = safeJoinUnderBase(
    workspaceRulesDir(workspaceRoot),
    ruleFile,
    "rules directory"
  );
  const sourcePath = enabled ? cursorActive : `${cursorActive}.disabled`;
  if (!(await pathExists(sourcePath))) {
    return;
  }
  const body = await fs.readFile(sourcePath, "utf8");
  const destination = safeJoinUnderBase(
    workspaceClineRulesDir(workspaceRoot),
    clineMirrorName(ruleFile),
    "Cline rules directory"
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await writeRuleMirror(destination, body, enabled);
}

/**
 * Rewrites the whole Cline mirror from the workspace's current Cursor rule
 * state. No-op when the workspace has no Cursor rules folder. Used after
 * bulk enable / disable commands.
 */
export async function syncClineMirrorFromWorkspace(
  workspaceRoot: string,
  ruleFiles: readonly string[]
): Promise<void> {
  const cursorDir = workspaceRulesDir(workspaceRoot);
  if (!(await pathExists(cursorDir))) {
    return;
  }
  for (const ruleFile of ruleFiles) {
    await mirrorRuleToCline(workspaceRoot, ruleFile, await isRuleEnabled(cursorDir, ruleFile));
  }
}

/**
 * Removes the leading YAML frontmatter block (`---` … `---`) from a Cursor
 * `.mdc` rule so the opencode mirror carries only the rule body. Returns the
 * body unchanged when the file does not start with frontmatter. Line endings
 * in a stripped body are normalized to `\n`; the generated mirror is not a
 * user-edited file, so this is intentional.
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

/**
 * True when the workspace shows evidence of opencode usage: an `AGENTS.md`,
 * an opencode config file, or a `.opencode/` directory at the root. Used to
 * gate the automatic opencode sync (the manual command ignores this check).
 */
export async function workspaceUsesOpencode(workspaceRoot: string): Promise<boolean> {
  const candidates = [
    path.join(workspaceRoot, "AGENTS.md"),
    path.join(workspaceRoot, "opencode.json"),
    path.join(workspaceRoot, "opencode.jsonc"),
    path.join(workspaceRoot, ".opencode"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * First existing opencode config file in the workspace, or the default
 * creation location (`.opencode/opencode.json`) when none exists yet.
 */
export async function resolveOpencodeConfigPath(workspaceRoot: string): Promise<string> {
  for (const candidate of [
    path.join(workspaceRoot, "opencode.json"),
    path.join(workspaceRoot, "opencode.jsonc"),
    path.join(workspaceRoot, ".opencode", "opencode.json"),
  ]) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return path.join(workspaceRoot, ".opencode", "opencode.json");
}

export type OpencodeConfigMergeResult =
  | "created-config"
  | "updated-config"
  | "unchanged"
  | "skipped";

/**
 * Ensures `glob` is present in the `instructions` array of the project's
 * opencode config, creating the file when it does not exist. JSONC surface
 * (line / block comments, trailing commas) is preserved byte-for-byte except
 * for the inserted entry. When the file cannot be parsed safely the function
 * returns `"skipped"` and never touches the file, so a hand-written config is
 * never corrupted.
 */
export async function ensureOpencodeInstructionsEntry(
  configPath: string,
  glob: string
): Promise<OpencodeConfigMergeResult> {
  let raw = "";
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Unable to read ${configPath}: ${String(error)}`);
    }
  }

  if (raw.trim() === "") {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      `{\n  "$schema": "https://opencode.ai/config.json",\n  "instructions": [${JSON.stringify(glob)}]\n}\n`,
      "utf8"
    );
    return "created-config";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsoncComments(raw));
  } catch {
    return "skipped";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "skipped";
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.instructions !== undefined && !Array.isArray(obj.instructions)) {
    return "skipped";
  }
  if (Array.isArray(obj.instructions) && obj.instructions.includes(glob)) {
    return "unchanged";
  }

  const tokens = tokenizeJsonc(raw);
  const edited = insertInstructionsGlob(raw, tokens, glob);
  if (edited === null) {
    return "skipped";
  }
  await fs.writeFile(configPath, edited, "utf8");
  return "updated-config";
}

/**
 * Read-only check: is `glob` already listed in the `instructions` array of
 * the opencode config? Returns false when the config is missing or cannot be
 * parsed safely. Never writes to the file.
 */
export async function opencodeConfigRegistersGlob(
  configPath: string,
  glob: string
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as Record<string, unknown>;
    return Array.isArray(parsed?.instructions) &&
      (parsed.instructions as readonly unknown[]).includes(glob);
  } catch {
    return false;
  }
}

/**
 * Copies each bundled rule into `.opencode/rules/ai-rules/` as a plain
 * `<topic>.md` file with the Cursor frontmatter stripped, and keeps the
 * generated folder out of source control. The mirror reflects the workspace's
 * Cursor rule state: enabled rules are written as `<topic>.md`, disabled ones
 * as `<topic>.md.disabled` (the `*.md` instructions glob skips those). When
 * the workspace has no Cursor rules folder yet, every rule defaults to
 * enabled.
 */
export async function syncBundledMdcsToOpencodeRules(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  const cursorDir = workspaceRulesDir(workspaceRoot);
  const hasCursorRules = await pathExists(cursorDir);
  const dest = workspaceOpencodeRulesDir(workspaceRoot);
  const mirrors = await Promise.all(
    ruleFiles.map(async (ruleFile) => {
      const source = await bundledRulePath(bundleDir, ruleFile);
      const enabled = hasCursorRules ? await isRuleEnabled(cursorDir, ruleFile) : true;
      return {
        body: renderRuleBody(
          stripCursorFrontmatter(await fs.readFile(source, "utf8")),
          testCommand
        ),
        enabled,
        destination: safeJoinUnderBase(
          dest,
          mdcToMdName(ruleFile),
          "opencode rules directory"
        ),
      };
    })
  );
  await fs.mkdir(dest, { recursive: true });
  for (const { body, enabled, destination } of mirrors) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await writeRuleMirror(destination, body, enabled);
  }
}

export function workspaceOpencodeRulesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".opencode", "rules", RULES_SUBDIR);
}

/** `<topic>.mdc` -> `<topic>.md`, shared by the opencode and Claude Code mirrors. */
function mdcToMdName(ruleFile: string): string {
  return `${ruleFile.replace(/\.mdc$/, "")}.md`;
}

/**
 * Writes a mirrored rule as `<name>` when enabled or `<name>.disabled` when
 * not, removing whichever counterpart existed. Shared by the opencode and
 * Claude Code mirrors, which use the same enabled/disabled convention.
 */
async function writeRuleMirror(
  destination: string,
  body: string,
  enabled: boolean
): Promise<void> {
  if (enabled) {
    await fs.rm(`${destination}.disabled`, { force: true });
    await fs.writeFile(destination, body, "utf8");
  } else {
    await fs.rm(destination, { force: true });
    await fs.writeFile(`${destination}.disabled`, body, "utf8");
  }
}

/**
 * Mirrors one rule into `.opencode/rules/ai-rules/` from the workspace's
 * Cursor rule file (`<topic>.mdc` when enabled, `<topic>.mdc.disabled` when
 * off), with the frontmatter stripped. Used to keep the opencode mirror in
 * sync immediately after a sidebar toggle.
 */
export async function mirrorRuleToOpencode(
  workspaceRoot: string,
  ruleFile: string,
  enabled: boolean
): Promise<void> {
  const cursorActive = safeJoinUnderBase(
    workspaceRulesDir(workspaceRoot),
    ruleFile,
    "rules directory"
  );
  const sourcePath = enabled ? cursorActive : `${cursorActive}.disabled`;
  if (!(await pathExists(sourcePath))) {
    return;
  }
  const body = stripCursorFrontmatter(await fs.readFile(sourcePath, "utf8"));
  const destination = safeJoinUnderBase(
    workspaceOpencodeRulesDir(workspaceRoot),
    mdcToMdName(ruleFile),
    "opencode rules directory"
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await writeRuleMirror(destination, body, enabled);
}

/**
 * Rewrites the whole opencode mirror from the workspace's current Cursor rule
 * state. No-op when the workspace has no Cursor rules folder. Used after
 * bulk enable / disable commands.
 */
export async function syncOpencodeMirrorFromWorkspace(
  workspaceRoot: string,
  ruleFiles: readonly string[]
): Promise<void> {
  const cursorDir = workspaceRulesDir(workspaceRoot);
  if (!(await pathExists(cursorDir))) {
    return;
  }
  for (const ruleFile of ruleFiles) {
    await mirrorRuleToOpencode(workspaceRoot, ruleFile, await isRuleEnabled(cursorDir, ruleFile));
  }
}

/**
 * True when the workspace shows evidence of Claude Code usage: a `CLAUDE.md`,
 * a `CLAUDE.local.md`, or a `.claude/` directory at the root. Used to gate the
 * automatic Claude Code sync (the manual command ignores this check).
 */
export async function workspaceUsesClaudeCode(workspaceRoot: string): Promise<boolean> {
  const candidates = [
    path.join(workspaceRoot, "CLAUDE.md"),
    path.join(workspaceRoot, "CLAUDE.local.md"),
    path.join(workspaceRoot, ".claude"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Parses the leading Cursor frontmatter block into field -> value pairs, or
 * `null` when the body has none or the block is unterminated. Only used to
 * read `globs`; not a general YAML parser.
 */
function parseCursorFrontmatterFields(body: string): Record<string, string> | null {
  const firstBreak = body.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? body : body.slice(0, firstBreak);
  if (firstLine.trim() !== "---") {
    return null;
  }
  const lines = body.split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return fields;
    }
    const match = /^(\w+):\s*(.*)$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return null;
}

/**
 * Converts a Cursor `.mdc` rule body into a Claude Code `.claude/rules/`
 * body: strips the Cursor frontmatter and, when the rule declared a `globs`
 * pattern, replaces it with the equivalent Claude `paths:` frontmatter so the
 * rule only loads for matching files. Claude has no `alwaysApply` field —
 * omitting `paths` already means "always load", matching Cursor's default.
 */
export function convertCursorRuleToClaudeRule(body: string): string {
  const fields = parseCursorFrontmatterFields(body);
  const rest = stripCursorFrontmatter(body);
  const globs = fields?.globs;
  if (!globs) {
    return rest;
  }
  return `---\npaths:\n  - ${JSON.stringify(globs)}\n---\n\n${rest}`;
}

/**
 * Copies each bundled rule into `.claude/rules/ai-rules/` as a plain
 * `<topic>.md` file with the Cursor frontmatter converted to Claude's `paths:`
 * form, and keeps the generated folder out of source control. The mirror
 * reflects the workspace's Cursor rule state: enabled rules are written as
 * `<topic>.md`, disabled ones as `<topic>.md.disabled` (Claude Code only
 * auto-loads `.md` files, so disabled mirrors are skipped without any config
 * registration). When the workspace has no Cursor rules folder yet, every
 * rule defaults to enabled.
 */
export async function syncBundledMdcsToClaudeRules(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand
): Promise<void> {
  const cursorDir = workspaceRulesDir(workspaceRoot);
  const hasCursorRules = await pathExists(cursorDir);
  const dest = workspaceClaudeRulesDir(workspaceRoot);
  const mirrors = await Promise.all(
    ruleFiles.map(async (ruleFile) => {
      const source = await bundledRulePath(bundleDir, ruleFile);
      const enabled = hasCursorRules ? await isRuleEnabled(cursorDir, ruleFile) : true;
      return {
        body: renderRuleBody(
          convertCursorRuleToClaudeRule(await fs.readFile(source, "utf8")),
          testCommand
        ),
        enabled,
        destination: safeJoinUnderBase(
          dest,
          mdcToMdName(ruleFile),
          "Claude Code rules directory"
        ),
      };
    })
  );
  await fs.mkdir(dest, { recursive: true });
  for (const { body, enabled, destination } of mirrors) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await writeRuleMirror(destination, body, enabled);
  }
}

/**
 * Mirrors one rule into `.claude/rules/ai-rules/` from the workspace's
 * Cursor rule file (`<topic>.mdc` when enabled, `<topic>.mdc.disabled` when
 * off), with the frontmatter converted. Used to keep the Claude Code mirror
 * in sync immediately after a sidebar toggle.
 */
export async function mirrorRuleToClaudeCode(
  workspaceRoot: string,
  ruleFile: string,
  enabled: boolean
): Promise<void> {
  const cursorActive = safeJoinUnderBase(
    workspaceRulesDir(workspaceRoot),
    ruleFile,
    "rules directory"
  );
  const sourcePath = enabled ? cursorActive : `${cursorActive}.disabled`;
  if (!(await pathExists(sourcePath))) {
    return;
  }
  const body = convertCursorRuleToClaudeRule(await fs.readFile(sourcePath, "utf8"));
  const destination = safeJoinUnderBase(
    workspaceClaudeRulesDir(workspaceRoot),
    mdcToMdName(ruleFile),
    "Claude Code rules directory"
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await writeRuleMirror(destination, body, enabled);
}

/**
 * Rewrites the whole Claude Code mirror from the workspace's current Cursor
 * rule state. No-op when the workspace has no Cursor rules folder. Used after
 * bulk enable / disable commands.
 */
export async function syncClaudeMirrorFromWorkspace(
  workspaceRoot: string,
  ruleFiles: readonly string[]
): Promise<void> {
  const cursorDir = workspaceRulesDir(workspaceRoot);
  if (!(await pathExists(cursorDir))) {
    return;
  }
  for (const ruleFile of ruleFiles) {
    await mirrorRuleToClaudeCode(workspaceRoot, ruleFile, await isRuleEnabled(cursorDir, ruleFile));
  }
}

async function removeRulesDirIfPresent(
  target: string,
  expectedSegments: readonly string[],
  label: string
): Promise<boolean> {
  if (!(await pathExists(target))) {
    return false;
  }
  assertSafeDeletionTarget(target, expectedSegments, label);
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

/** Deletes `.cursor/rules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeCursorRules(workspaceRoot: string): Promise<boolean> {
  return removeRulesDirIfPresent(
    workspaceRulesDir(workspaceRoot),
    RULES_DIR_SEGMENTS,
    "Cursor rules folder"
  );
}

/** Deletes `.clinerules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeClineRules(workspaceRoot: string): Promise<boolean> {
  return removeRulesDirIfPresent(
    workspaceClineRulesDir(workspaceRoot),
    CLINE_RULES_DIR_SEGMENTS,
    "Cline rules folder"
  );
}

/** Deletes `.opencode/rules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeOpencodeRules(workspaceRoot: string): Promise<boolean> {
  return removeRulesDirIfPresent(
    workspaceOpencodeRulesDir(workspaceRoot),
    OPENCODE_RULES_DIR_SEGMENTS,
    "opencode rules folder"
  );
}

/** Deletes `.claude/rules/ai-rules/` when present. Returns whether anything was removed. */
export async function removeClaudeRules(workspaceRoot: string): Promise<boolean> {
  return removeRulesDirIfPresent(
    workspaceClaudeRulesDir(workspaceRoot),
    CLAUDE_RULES_DIR_SEGMENTS,
    "Claude Code rules folder"
  );
}

/** Deletes every supported rule-pack folder that exists in the workspace. */
export async function removeAllRuleFormats(
  workspaceRoot: string
): Promise<RuleFormatRemovalResult> {
  return {
    cursor: await removeCursorRules(workspaceRoot),
    cline: await removeClineRules(workspaceRoot),
    opencode: await removeOpencodeRules(workspaceRoot),
    claude: await removeClaudeRules(workspaceRoot),
  };
}

type JsoncToken = {
  kind: "{" | "}" | "[" | "]" | ":" | "," | "string" | "other";
  start: number;
  end: number;
  text: string;
};

/** Scans JSONC text into structural tokens, skipping whitespace and comments. */
function tokenizeJsonc(text: string): JsoncToken[] {
  const tokens: JsoncToken[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i = Math.min(i + 2, n);
      continue;
    }
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ kind: "string", start, end: i, text: text.slice(start, i) });
      continue;
    }
    if ("{}[]:,".includes(ch)) {
      tokens.push({ kind: ch as JsoncToken["kind"], start: i, end: i + 1, text: ch });
      i++;
      continue;
    }
    const start = i;
    while (i < n && !' \t\n\r{}[]:,"/'.includes(text[i])) {
      i++;
    }
    tokens.push({ kind: "other", start, end: i, text: text.slice(start, i) });
  }
  return tokens;
}

/**
 * Strips line and block comments (string-aware) and trailing commas before
 * `}` / `]` so the result is strict JSON. Only used to *validate* a JSONC
 * file before surgical text edits; the original text is what gets written.
 */
function stripJsoncComments(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += text.slice(start, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i = Math.min(i + 2, n);
      continue;
    }
    if (ch === ",") {
      let k = i + 1;
      while (k < n && (text[k] === " " || text[k] === "\t" || text[k] === "\n" || text[k] === "\r")) {
        k++;
      }
      if (text[k] === "}" || text[k] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function matchingBracket(tokens: readonly JsoncToken[], openIndex: number): number {
  const openKind = tokens[openIndex].kind;
  const closeKind = openKind === "{" ? "}" : "]";
  let depth = 0;
  for (let j = openIndex; j < tokens.length; j++) {
    if (tokens[j].kind === openKind) {
      depth++;
    } else if (tokens[j].kind === closeKind) {
      depth--;
    }
    if (depth === 0) {
      return j;
    }
  }
  return -1;
}

function lineIndentBefore(text: string, pos: number): string {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return match ? match[0] : "";
}

/**
 * Returns edited text inserting `glob` into the top-level `instructions`
 * array (or adding a new `instructions` member), or `null` when the structure
 * cannot be located. Callers only invoke this after strict-JSON validation,
 * so malformed input is expected to have been rejected earlier.
 */
function insertInstructionsGlob(
  raw: string,
  tokens: readonly JsoncToken[],
  glob: string
): string | null {
  const open = tokens.findIndex((token) => token.kind === "{");
  if (open === -1) {
    return null;
  }
  const close = matchingBracket(tokens, open);
  if (close === -1) {
    return null;
  }

  let depth = 0;
  for (let j = open + 1; j < close; j++) {
    const token = tokens[j];
    if (token.kind === "{" || token.kind === "[") {
      depth++;
      continue;
    }
    if (token.kind === "}" || token.kind === "]") {
      depth--;
      continue;
    }
    if (
      depth === 0 &&
      token.kind === "string" &&
      tokens[j + 1]?.kind === ":" &&
      JSON.parse(token.text) === "instructions"
    ) {
      const value = tokens[j + 2];
      if (!value || value.kind !== "[") {
        return null;
      }
      const arrayClose = matchingBracket(tokens, j + 2);
      if (arrayClose === -1) {
        return null;
      }
      if (arrayClose === j + 3) {
        const insertAt = tokens[arrayClose].start;
        return raw.slice(0, insertAt) + JSON.stringify(glob) + raw.slice(insertAt);
      }
      const previous = tokens[arrayClose - 1];
      const gap = raw.slice(previous.end, tokens[arrayClose].start);
      if (/\r|\n/.test(gap)) {
        const prevLineIndent = lineIndentBefore(raw, previous.start);
        const leading = previous.kind === "," ? "" : ",";
        const insertAt = previous.end;
        const inserted = `${leading}\n${prevLineIndent}${JSON.stringify(glob)}`;
        return raw.slice(0, insertAt) + inserted + raw.slice(insertAt);
      }
      const prefix = previous.kind === "," ? "" : ", ";
      const insertAt = tokens[arrayClose].start;
      return raw.slice(0, insertAt) + prefix + JSON.stringify(glob) + raw.slice(insertAt);
    }
  }

  const insertAt = tokens[close].start;
  const hasMembers = tokens
    .slice(open + 1, close)
    .some((token) => token.kind !== ":" && token.kind !== ",");
  const previous = tokens[close - 1];
  const comma = hasMembers && previous?.kind !== "," ? "," : "";
  const closingIndent = lineIndentBefore(raw, insertAt);
  const indentUnit = closingIndent.includes("\t") ? "\t" : "  ";
  const before = raw.slice(0, insertAt);
  const leading = before.endsWith("\n") || before.endsWith("\r") ? "" : "\n";
  const member =
    `${comma}${leading}${closingIndent}${indentUnit}"instructions": [${JSON.stringify(glob)}]\n` +
    closingIndent;
  return before + member + raw.slice(insertAt);
}
