import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Token used in bundled rule text wherever the project's own test command
 * belongs. Rules are shipped with the token and rendered on the way into a
 * workspace, so no installed rule ever tells an agent to run a placeholder.
 */
export const TEST_COMMAND_PLACEHOLDER = "{{TEST_COMMAND}}";

/** Substituted when detection fails, so the sentence still reads correctly. */
export const UNKNOWN_TEST_COMMAND_TEXT = "the project's test command";

/** The script `npm init` writes; its presence means "no tests configured". */
const NPM_DEFAULT_TEST_SCRIPT = /^\s*echo\s+["']?Error: no test specified/i;

const LOCKFILE_RUNNERS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
] as const;

/** Marker file alone is enough to know the ecosystem's test command. */
const MARKER_FILE_COMMANDS = [
  ["Cargo.toml", "cargo test"],
  ["go.mod", "go test ./..."],
  ["pytest.ini", "pytest"],
] as const;

/** Marker file only implies pytest when its contents mention pytest config. */
const PYTEST_CONFIG_FILES = [
  ["pyproject.toml", /^\s*\[tool\.pytest/m],
  ["setup.cfg", /^\s*\[tool:pytest\]/m],
  ["tox.ini", /^\s*\[pytest\]/m],
] as const;

async function readTextFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function detectNodeTestCommand(workspaceRoot: string): Promise<string | null> {
  const raw = await readTextFile(path.join(workspaceRoot, "package.json"));
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") {
    return null;
  }
  const script = (scripts as { test?: unknown }).test;
  if (typeof script !== "string" || script.trim() === "") {
    return null;
  }
  if (NPM_DEFAULT_TEST_SCRIPT.test(script)) {
    return null;
  }
  for (const [lockfile, runner] of LOCKFILE_RUNNERS) {
    if (await fileExists(path.join(workspaceRoot, lockfile))) {
      return `${runner} test`;
    }
  }
  return "npm test";
}

async function detectMarkerFileTestCommand(workspaceRoot: string): Promise<string | null> {
  for (const [marker, command] of MARKER_FILE_COMMANDS) {
    if (await fileExists(path.join(workspaceRoot, marker))) {
      return command;
    }
  }
  for (const [marker, pattern] of PYTEST_CONFIG_FILES) {
    const contents = await readTextFile(path.join(workspaceRoot, marker));
    if (contents !== null && pattern.test(contents)) {
      return "pytest";
    }
  }
  return null;
}

async function detectMakeTestCommand(workspaceRoot: string): Promise<string | null> {
  for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
    const contents = await readTextFile(path.join(workspaceRoot, name));
    if (contents !== null && /^test:/m.test(contents)) {
      return "make test";
    }
  }
  return null;
}

/**
 * Best-effort test command for `workspaceRoot`, or `null` when the project
 * gives no clear signal. Only unambiguous evidence counts: a real `test`
 * script, an ecosystem manifest, or a `test` target. Guessing wrong is worse
 * than falling back to prose, because an agent will run whatever we name here.
 */
export async function detectTestCommand(workspaceRoot: string): Promise<string | null> {
  return (
    (await detectNodeTestCommand(workspaceRoot)) ??
    (await detectMarkerFileTestCommand(workspaceRoot)) ??
    (await detectMakeTestCommand(workspaceRoot))
  );
}

/** Replaces every placeholder in a rule body on the way into a workspace. */
export function renderRuleBody(body: string, testCommand: string | null | undefined): string {
  const replacement = testCommand ? `\`${testCommand}\`` : UNKNOWN_TEST_COMMAND_TEXT;
  return body.replaceAll(TEST_COMMAND_PLACEHOLDER, replacement);
}
