import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  assertContainedPath,
  assertSafeDeletionTarget,
  isSafeManifestEntry,
} from "./safePaths";

const RULES_SUBDIR = "ai-rules";
const LEGACY_CORE_RULE_FILE = "core.mdc";
export const GENERATED_RULE_IGNORE_ENTRIES = [
  "/.cursor/rules/ai-rules/",
  "/.clinerules/ai-rules/",
  "/.opencode/rules/ai-rules/",
] as const;

/** Glob registered in the project's opencode config `instructions` array. */
export const OPENCODE_RULES_GLOB = ".opencode/rules/ai-rules/*.md";

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
  ruleFiles: readonly string[]
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
    await fs.copyFile(source, destination);
  }
  const legacyCore = safeJoinUnderBase(rulesDir, LEGACY_CORE_RULE_FILE, "rules directory");
  await fs.rm(legacyCore, { force: true });
  await fs.rm(`${legacyCore}.disabled`, { force: true });
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
  bundleDir: string,
  ruleFiles: readonly string[]
): Promise<void> {
  await ensureAiRulesIgnored(workspaceRoot);
  const dest = path.join(workspaceRoot, ".clinerules", RULES_SUBDIR);
  const mirrors = await Promise.all(
    ruleFiles.map(async (ruleFile) => {
      const source = await bundledRulePath(bundleDir, ruleFile);
      const mirrorName = `ai-rules-${ruleFile.slice(0, -".mdc".length).replaceAll("/", "-")}.md`;
      return {
        source,
        destination: safeJoinUnderBase(dest, mirrorName, "Cline rules directory"),
      };
    })
  );
  await fs.mkdir(dest, { recursive: true });
  for (const { source, destination } of mirrors) {
    const body = await fs.readFile(source, "utf8");
    await fs.writeFile(destination, body, "utf8");
  }
  await fs.rm(path.join(dest, "ai-rules-core.md"), { force: true });
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
  ruleFiles: readonly string[]
): Promise<void> {
  await ensureAiRulesIgnored(workspaceRoot);
  const cursorDir = workspaceRulesDir(workspaceRoot);
  const hasCursorRules = await pathExists(cursorDir);
  const dest = workspaceOpencodeRulesDir(workspaceRoot);
  const mirrors = await Promise.all(
    ruleFiles.map(async (ruleFile) => {
      const source = await bundledRulePath(bundleDir, ruleFile);
      const enabled = hasCursorRules ? await isRuleEnabled(cursorDir, ruleFile) : true;
      return {
        body: stripCursorFrontmatter(await fs.readFile(source, "utf8")),
        enabled,
        destination: safeJoinUnderBase(
          dest,
          opencodeMirrorName(ruleFile),
          "opencode rules directory"
        ),
      };
    })
  );
  await fs.mkdir(dest, { recursive: true });
  for (const { body, enabled, destination } of mirrors) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await writeOpencodeMirror(destination, body, enabled);
  }
}

export function workspaceOpencodeRulesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".opencode", "rules", RULES_SUBDIR);
}

function opencodeMirrorName(ruleFile: string): string {
  return `${ruleFile.replace(/\.mdc$/, "")}.md`;
}

async function writeOpencodeMirror(
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
    opencodeMirrorName(ruleFile),
    "opencode rules directory"
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await writeOpencodeMirror(destination, body, enabled);
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
