import * as path from "node:path";

/**
 * Defensive path helpers used at every boundary that resolves a manifest entry
 * (or any user / disk-supplied relative path) under a trusted base directory.
 *
 * Treating these inputs as untrusted protects against:
 *  - path traversal (`../../etc/passwd`) sneaking into the manifest after install
 *  - destructive operations (rm -rf) on a path that doesn't look like our own
 *  - copying through a symlink that points outside the bundle / rules folder
 */

const MAX_ENTRY_LENGTH = 200;
const SAFE_ENTRY_PATTERN = /^[A-Za-z0-9_./-]+$/;

export function isSafeManifestEntry(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length === 0 || value.length > MAX_ENTRY_LENGTH) {
    return false;
  }
  if (!SAFE_ENTRY_PATTERN.test(value)) {
    return false;
  }
  if (value.includes("..")) {
    return false;
  }
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("\\")) {
    return false;
  }
  return true;
}

export function isContainedPath(base: string, candidate: string): boolean {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedBase) {
    return true;
  }
  const rel = path.relative(resolvedBase, resolvedCandidate);
  if (rel === "" || rel === ".") {
    return true;
  }
  if (rel.startsWith("..")) {
    return false;
  }
  return !path.isAbsolute(rel);
}

export function assertContainedPath(base: string, candidate: string, label: string): void {
  if (!isContainedPath(base, candidate)) {
    throw new Error(`Refusing to access path outside ${label}: ${candidate}`);
  }
}

/**
 * Returns true when `target`'s resolved path ends with `expectedSegments` in
 * order. Used to gate destructive operations on `.cursor/rules/ai-rules` so a
 * corrupted constant can't widen the blast radius.
 */
export function endsWithPathSegments(target: string, expectedSegments: readonly string[]): boolean {
  const resolved = path.resolve(target).split(path.sep).filter((s) => s.length > 0);
  if (resolved.length < expectedSegments.length) {
    return false;
  }
  const tail = resolved.slice(resolved.length - expectedSegments.length);
  return expectedSegments.every((seg, i) => seg === tail[i]);
}

export function assertSafeDeletionTarget(
  target: string,
  expectedSegments: readonly string[],
  label: string
): void {
  if (!endsWithPathSegments(target, expectedSegments)) {
    throw new Error(
      `Refusing to delete ${label}: ${target} (expected path ending with ${expectedSegments.join("/")})`
    );
  }
}
