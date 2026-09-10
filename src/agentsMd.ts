import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stripCursorFrontmatter, type TestCommand } from "./rulesOperations";
import { assertContainedPath, isSafeManifestEntry } from "./safePaths";
import { renderRuleBody } from "./testCommand";

/**
 * The rule pack lives in one place per workspace: a managed block inside
 * `AGENTS.md`, the file most agents (Cursor, Cline, opencode, Windsurf,
 * Copilot, ...) read by convention. Claude Code is pointed at it from
 * `CLAUDE.md` (see `claudeMd.ts`).
 *
 * Block layout, regenerated on every install / toggle:
 *
 *   <!-- ai-rulebook:start -->
 *   <!-- Managed by ... -->
 *
 *   <!-- ai-rulebook:rule scope enabled -->
 *
 *   ## Scope
 *   ...
 *
 *   <!-- ai-rulebook:end-rule scope -->
 *
 *   <!-- ai-rulebook:rule git disabled -->
 *   <!-- ai-rulebook:end-rule git -->
 *   <!-- ai-rulebook:end -->
 *
 * A disabled rule keeps its (empty) section so its state survives reinstalls,
 * but its text is removed rather than commented out: agents read the raw
 * file, and a rule an agent can still see is not really off. Everything
 * outside the two block markers belongs to the user and is never touched.
 */

export const AGENTS_MD = "AGENTS.md";
export const AGENTS_MD_BLOCK_START = "<!-- ai-rulebook:start -->";
export const AGENTS_MD_BLOCK_END = "<!-- ai-rulebook:end -->";
const BLOCK_NOTE =
  "<!-- Managed by the AI Rulebook extension. Text between the ai-rulebook markers is regenerated on install; toggle rules from the AI Rulebook sidebar instead of editing here. -->";
const DEFAULT_TITLE = "# AGENTS.md";

/** Serialize whole read-modify-write operations within this extension host. */
const pendingMutations = new Map<string, Promise<void>>();

function withWorkspaceMutation<T>(workspaceRoot: string, mutate: () => Promise<T>): Promise<T> {
  const key = path.resolve(workspaceRoot);
  const previous = pendingMutations.get(key) ?? Promise.resolve();
  const result = previous.then(mutate);
  // Keep the queue usable after failure; the caller still receives result's rejection.
  const settled = result.then(() => {}, () => {});
  pendingMutations.set(key, settled);
  void settled.then(() => {
    if (pendingMutations.get(key) === settled) {
      pendingMutations.delete(key);
    }
  });
  return result;
}

const RULE_START_PATTERN = /^<!-- ai-rulebook:rule (\S+) (enabled|disabled) -->$/;
const RULE_END_PATTERN = /^<!-- ai-rulebook:end-rule (\S+) -->$/;

export type AgentsMdRule = {
  id: string;
  enabled: boolean;
  /** Rendered rule text; empty when the rule is disabled. */
  body: string;
};

export type ParsedAgentsMd = {
  /** Text before the start marker line, verbatim. */
  before: string;
  /** Text after the end marker line (and its line break), verbatim. */
  after: string;
  rules: AgentsMdRule[];
};

export type InstallOptions = {
  /** Re-enable every rule instead of keeping the state recorded in the block. */
  enableAll?: boolean;
};

export function agentsMdPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, AGENTS_MD);
}

/** `scope.mdc` -> `scope`, `nested/my_rule.mdc` -> `nested-my_rule`. */
export function ruleId(ruleFile: string): string {
  return ruleFile.replace(/\.mdc$/, "").split("/").filter(Boolean).join("-");
}

export function ruleStartMarker(id: string, enabled: boolean): string {
  return `<!-- ai-rulebook:rule ${id} ${enabled ? "enabled" : "disabled"} -->`;
}

export function ruleEndMarker(id: string): string {
  return `<!-- ai-rulebook:end-rule ${id} -->`;
}

function assertSafeRuleFile(ruleFile: string): void {
  if (!isSafeManifestEntry(ruleFile)) {
    throw new Error(`Refusing unsafe rule path: ${ruleFile}`);
  }
}

/**
 * Demotes every ATX heading by one level (h6 stays h6) so a rule's `# Title`
 * nests under the host file's own top-level heading. Fenced code is skipped.
 */
function demoteHeadings(text: string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (fence === null) {
          fence = marker;
        } else if (marker[0] === fence[0] && marker.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      if (fence !== null) {
        return line;
      }
      const heading = /^(#{1,6})(\s+\S.*|\s*)$/.exec(line);
      if (!heading || heading[1].length >= 6) {
        return line;
      }
      return `#${line}`;
    })
    .join("\n");
}

/** Turns a bundled `.mdc` body into the text that goes inside its section. */
export function renderRuleForAgentsMd(mdcBody: string, testCommand: TestCommand): string {
  const withoutFrontmatter = stripCursorFrontmatter(mdcBody).replace(/\r\n/g, "\n");
  return demoteHeadings(renderRuleBody(withoutFrontmatter, testCommand)).trim();
}

/** Reads and renders one bundled rule, validating the path on the way. */
async function renderBundledRule(
  bundleDir: string,
  ruleFile: string,
  testCommand: TestCommand
): Promise<string> {
  assertSafeRuleFile(ruleFile);
  const abs = path.join(bundleDir, ruleFile);
  assertContainedPath(bundleDir, abs, "bundled rule pack");
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Bundled rule missing: ${ruleFile}`);
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read bundled rule ${ruleFile}: ${reason}`);
  }
  return renderRuleForAgentsMd(raw, testCommand);
}

/**
 * Splits `text` into the user's content and the managed block. Returns
 * `null` when there is no block. Throws on a damaged block so callers never
 * rewrite a file they cannot fully account for.
 */
export function parseAgentsMd(text: string): ParsedAgentsMd | null {
  const lines = text.split("\n");
  const isMarker = (line: string, marker: string) => line.replace(/\r$/, "") === marker;
  const startIndexes: number[] = [];
  const endIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (isMarker(line, AGENTS_MD_BLOCK_START)) {
      startIndexes.push(index);
    } else if (isMarker(line, AGENTS_MD_BLOCK_END)) {
      endIndexes.push(index);
    }
  });
  if (startIndexes.length === 0 && endIndexes.length === 0) {
    return null;
  }
  if (startIndexes.length > 1 || endIndexes.length > 1) {
    throw new Error(`${AGENTS_MD} contains more than one ai-rulebook block.`);
  }
  if (endIndexes.length === 0) {
    throw new Error(
      `${AGENTS_MD} has an "${AGENTS_MD_BLOCK_START}" marker but no matching ai-rulebook:end marker.`
    );
  }
  if (startIndexes.length === 0) {
    throw new Error(
      `${AGENTS_MD} has an "${AGENTS_MD_BLOCK_END}" marker but no matching ai-rulebook:start marker.`
    );
  }
  const start = startIndexes[0];
  const end = endIndexes[0];
  if (end < start) {
    throw new Error(`${AGENTS_MD} has its ai-rulebook:end marker before ai-rulebook:start.`);
  }

  const rules: AgentsMdRule[] = [];
  const seen = new Set<string>();
  let open: { id: string; enabled: boolean; bodyLines: string[] } | null = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i].replace(/\r$/, "");
    const startMatch = RULE_START_PATTERN.exec(line);
    const endMatch = RULE_END_PATTERN.exec(line);
    if (startMatch) {
      if (open) {
        throw new Error(
          `${AGENTS_MD} is missing the ai-rulebook:end-rule ${open.id} marker.`
        );
      }
      if (seen.has(startMatch[1])) {
        throw new Error(`${AGENTS_MD} lists rule "${startMatch[1]}" twice.`);
      }
      seen.add(startMatch[1]);
      open = { id: startMatch[1], enabled: startMatch[2] === "enabled", bodyLines: [] };
    } else if (endMatch) {
      if (!open || open.id !== endMatch[1]) {
        throw new Error(
          `${AGENTS_MD} has an ai-rulebook:end-rule ${endMatch[1]} marker without its start marker.`
        );
      }
      rules.push({
        id: open.id,
        enabled: open.enabled,
        body: open.enabled ? open.bodyLines.join("\n").trim() : "",
      });
      open = null;
    } else if (open) {
      open.bodyLines.push(line);
    }
  }
  if (open) {
    throw new Error(`${AGENTS_MD} is missing the ai-rulebook:end-rule ${open.id} marker.`);
  }

  const before = lines.slice(0, start).join("\n") + (start > 0 ? "\n" : "");
  const after = lines.slice(end + 1).join("\n");
  return { before, after, rules };
}

function renderSection(rule: AgentsMdRule): string {
  if (!rule.enabled) {
    return `${ruleStartMarker(rule.id, false)}\n${ruleEndMarker(rule.id)}\n`;
  }
  return `${ruleStartMarker(rule.id, true)}\n\n${rule.body}\n\n${ruleEndMarker(rule.id)}\n`;
}

function renderBlock(rules: readonly AgentsMdRule[]): string {
  const sections = rules.map(renderSection).join("\n");
  return `${AGENTS_MD_BLOCK_START}\n${BLOCK_NOTE}\n\n${sections}${AGENTS_MD_BLOCK_END}\n`;
}

async function readAgentsMd(workspaceRoot: string): Promise<string | null> {
  try {
    return await fs.readFile(agentsMdPath(workspaceRoot), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read ${AGENTS_MD}: ${reason}`);
  }
}

async function readParsedAgentsMd(
  workspaceRoot: string
): Promise<{ text: string | null; parsed: ParsedAgentsMd | null }> {
  const text = await readAgentsMd(workspaceRoot);
  return { text, parsed: text === null ? null : parseAgentsMd(text) };
}

async function writeAgentsMd(workspaceRoot: string, text: string): Promise<void> {
  try {
    await fs.writeFile(agentsMdPath(workspaceRoot), text, "utf8");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to write ${AGENTS_MD}: ${reason}`);
  }
}

/** Composes the whole file from the user's content and a fresh block. */
function composeFile(existing: string | null, parsed: ParsedAgentsMd | null, block: string): string {
  if (parsed) {
    return parsed.before + block + parsed.after;
  }
  if (existing === null) {
    return `${DEFAULT_TITLE}\n\n${block}`;
  }
  if (existing.trim() === "") {
    return block;
  }
  const trailing = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${trailing}\n${block}`;
}

/**
 * Installs (or refreshes) the rule pack block. Rules already in the block keep
 * their enabled/disabled state unless `enableAll` is set; rules the bundle no
 * longer ships are dropped; new rules start enabled. Every bundled rule is
 * read before anything is written.
 */
export async function installRulesIntoAgentsMd(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  testCommand: TestCommand,
  options: InstallOptions = {}
): Promise<{ created: boolean }> {
  return withWorkspaceMutation(workspaceRoot, async () => {
    const rendered = new Map<string, string>();
    for (const ruleFile of ruleFiles) {
      rendered.set(ruleFile, await renderBundledRule(bundleDir, ruleFile, testCommand));
    }
    const { text, parsed } = await readParsedAgentsMd(workspaceRoot);
    const previousState = new Map((parsed?.rules ?? []).map((rule) => [rule.id, rule.enabled]));
    const rules: AgentsMdRule[] = ruleFiles.map((ruleFile) => {
      const id = ruleId(ruleFile);
      const enabled = options.enableAll ? true : previousState.get(id) ?? true;
      return { id, enabled, body: enabled ? rendered.get(ruleFile) ?? "" : "" };
    });
    await writeAgentsMd(workspaceRoot, composeFile(text, parsed, renderBlock(rules)));
    return { created: text === null };
  });
}

export async function hasRulesBlock(workspaceRoot: string): Promise<boolean> {
  const text = await readAgentsMd(workspaceRoot);
  if (text === null) {
    return false;
  }
  try {
    return parseAgentsMd(text) !== null;
  } catch {
    // A damaged block still counts as "installed"; callers that need the
    // details parse it themselves and surface the error.
    return true;
  }
}

export async function isRuleEnabledInAgentsMd(
  workspaceRoot: string,
  ruleFile: string
): Promise<boolean> {
  assertSafeRuleFile(ruleFile);
  const { parsed } = await readParsedAgentsMd(workspaceRoot);
  if (!parsed) {
    return false;
  }
  const id = ruleId(ruleFile);
  return parsed.rules.some((rule) => rule.id === id && rule.enabled);
}

async function updateRules(
  workspaceRoot: string,
  bundleDir: string,
  changes: ReadonlyMap<string, boolean>,
  testCommand: TestCommand
): Promise<void> {
  return withWorkspaceMutation(workspaceRoot, async () => {
    for (const ruleFile of changes.keys()) {
      assertSafeRuleFile(ruleFile);
    }
    const { text, parsed } = await readParsedAgentsMd(workspaceRoot);
    if (!parsed) {
      throw new Error(
        `The rule pack is not installed in ${AGENTS_MD} yet. Run "AI Rulebook: Install / update rule pack" first.`
      );
    }
    const rules = [...parsed.rules];
    for (const [ruleFile, enabled] of changes) {
      const id = ruleId(ruleFile);
      const body = enabled ? await renderBundledRule(bundleDir, ruleFile, testCommand) : "";
      const index = rules.findIndex((rule) => rule.id === id);
      const next: AgentsMdRule = { id, enabled, body };
      if (index === -1) {
        rules.push(next);
      } else {
        rules[index] = next;
      }
    }
    const updated = parsed.before + renderBlock(rules) + parsed.after;
    if (updated !== text) {
      await writeAgentsMd(workspaceRoot, updated);
    }
  });
}

/**
 * Flips one rule's section. Enabling re-renders the text from the bundle so
 * the workspace always carries the current wording and test command.
 */
export async function setRuleEnabledInAgentsMd(
  workspaceRoot: string,
  bundleDir: string,
  ruleFile: string,
  enabled: boolean,
  testCommand: TestCommand
): Promise<void> {
  await updateRules(workspaceRoot, bundleDir, new Map([[ruleFile, enabled]]), testCommand);
}

export async function setAllRulesEnabledInAgentsMd(
  workspaceRoot: string,
  bundleDir: string,
  ruleFiles: readonly string[],
  enabled: boolean,
  testCommand: TestCommand
): Promise<void> {
  await updateRules(
    workspaceRoot,
    bundleDir,
    new Map(ruleFiles.map((ruleFile) => [ruleFile, enabled])),
    testCommand
  );
}

/**
 * Removes the managed block. Deletes the file when nothing but the scaffold
 * this extension wrote would remain; otherwise keeps the user's text intact.
 */
export async function removeRulesBlockFromAgentsMd(
  workspaceRoot: string
): Promise<{ removed: boolean; deletedFile: boolean }> {
  return withWorkspaceMutation(workspaceRoot, async () => {
    const { parsed } = await readParsedAgentsMd(workspaceRoot);
    if (!parsed) {
      return { removed: false, deletedFile: false };
    }
    const before = parsed.before.trimEnd();
    const after = parsed.after.replace(/^(\r?\n)+/, "");
    const remainder = [before, after].filter((part) => part.trim() !== "").join("\n\n");
    if (remainder.trim() === "" || remainder.trim() === DEFAULT_TITLE) {
      await fs.rm(agentsMdPath(workspaceRoot), { force: true });
      return { removed: true, deletedFile: true };
    }
    await writeAgentsMd(workspaceRoot, remainder.endsWith("\n") ? remainder : `${remainder}\n`);
    return { removed: true, deletedFile: false };
  });
}

/** Zero-based line of the rule's start marker in `text`, or `null`. */
export function ruleSectionLine(text: string, ruleFile: string): number | null {
  const id = ruleId(ruleFile);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = RULE_START_PATTERN.exec(lines[i].replace(/\r$/, ""));
    if (match && match[1] === id) {
      return i;
    }
  }
  return null;
}
