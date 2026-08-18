import { strict as assert } from "node:assert";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  assertContainedPath,
  assertSafeDeletionTarget,
  endsWithPathSegments,
  isContainedPath,
  isSafeManifestEntry,
} from "../out/safePaths.js";

describe("isSafeManifestEntry", () => {
  test("accepts forward-slash relative pack paths", () => {
    assert.equal(isSafeManifestEntry("coding-rules/write-clean-code.mdc"), true);
    assert.equal(isSafeManifestEntry("ABOUT_RULES.md"), true);
    assert.equal(isSafeManifestEntry("ai-rules-coding-rules-write-clean-code.md"), true);
  });

  test("rejects empty, over-long, and non-string values", () => {
    assert.equal(isSafeManifestEntry(""), false);
    assert.equal(isSafeManifestEntry("a".repeat(201)), false);
    assert.equal(isSafeManifestEntry("a".repeat(200)), true);
    assert.equal(isSafeManifestEntry(null), false);
    assert.equal(isSafeManifestEntry(undefined), false);
    assert.equal(isSafeManifestEntry(12), false);
  });

  test("rejects traversal, absolute, and dotted-relative shapes", () => {
    assert.equal(isSafeManifestEntry("../etc/passwd"), false);
    assert.equal(isSafeManifestEntry("foo/../bar.mdc"), false);
    assert.equal(isSafeManifestEntry("/etc/passwd"), false);
    assert.equal(isSafeManifestEntry("./coding-rules/x.mdc"), false);
    assert.equal(isSafeManifestEntry("\\windows\\path"), false);
  });

  test("rejects characters outside the allowlist", () => {
    assert.equal(isSafeManifestEntry("foo bar.mdc"), false);
    assert.equal(isSafeManifestEntry("foo\\bar.mdc"), false);
    assert.equal(isSafeManifestEntry("rule.mdc;rm"), false);
    assert.equal(isSafeManifestEntry("rule.mdc\n"), false);
  });
});

describe("isContainedPath / assertContainedPath", () => {
  const base = path.join("/tmp", "airules-base");

  test("the base itself and files under it are contained", () => {
    assert.equal(isContainedPath(base, base), true);
    assert.equal(isContainedPath(base, path.join(base, "coding-rules", "x.mdc")), true);
  });

  test("siblings and parent escapes are not contained", () => {
    assert.equal(isContainedPath(base, path.join("/tmp", "other")), false);
    assert.equal(isContainedPath(base, path.join(base, "..", "escape")), false);
  });

  test("assertContainedPath throws with the label when out of tree", () => {
    assert.throws(
      () => assertContainedPath(base, path.join("/tmp", "other"), "rules directory"),
      /Refusing to access path outside rules directory/
    );
    assert.doesNotThrow(() =>
      assertContainedPath(base, path.join(base, "x.mdc"), "rules directory")
    );
  });
});

describe("endsWithPathSegments / assertSafeDeletionTarget", () => {
  test("matches the expected suffix regardless of extra ancestors", () => {
    const target = path.join("/Users", "me", "proj", ".cursor", "rules", "ai-rules");
    assert.equal(endsWithPathSegments(target, [".cursor", "rules", "ai-rules"]), true);
    assert.equal(endsWithPathSegments(target, ["ai-rules-mirror", "ai-rules"]), false);
  });

  test("rejects a path shorter than the expected suffix", () => {
    assert.equal(endsWithPathSegments(path.join("/tmp", "ai-rules"), [".cursor", "rules", "ai-rules"]), false);
  });

  test("assertSafeDeletionTarget throws when the suffix does not match", () => {
    const bad = path.join("/tmp", "not-the-rules-folder");
    assert.throws(
      () => assertSafeDeletionTarget(bad, [".cursor", "rules", "ai-rules"], "workspace rules folder"),
      /Refusing to delete workspace rules folder/
    );
    const ok = path.join("/tmp", "ws", ".cursor", "rules", "ai-rules");
    assert.doesNotThrow(() =>
      assertSafeDeletionTarget(ok, [".cursor", "rules", "ai-rules"], "workspace rules folder")
    );
  });
});
