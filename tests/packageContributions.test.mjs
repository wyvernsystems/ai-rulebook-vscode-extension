import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

import { UI_COLORS } from "../out/uiPresentation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  await fs.readFile(path.join(repoRoot, "package.json"), "utf8")
);
const contributions = packageJson.contributes;

describe("VS Code package contributions", () => {
  test("command identifiers are unique", () => {
    const commandIds = contributions.commands.map((command) => command.command);

    assert.equal(new Set(commandIds).size, commandIds.length);
  });

  test("contributes individual and whole-pack enable and disable commands", () => {
    const commandIds = new Set(
      contributions.commands.map((command) => command.command)
    );

    for (const command of [
      "aiRules.enableRuleWorkspace",
      "aiRules.disableRuleWorkspace",
      "aiRules.enableCoreWorkspace",
      "aiRules.disableCoreWorkspace",
    ]) {
      assert.ok(commandIds.has(command), `missing rule-state command: ${command}`);
    }
  });

  test("contributes install, remove, legacy-cleanup, and status commands", () => {
    const commandIds = new Set(
      contributions.commands.map((command) => command.command)
    );

    for (const command of [
      "aiRules.installWorkspace",
      "aiRules.removeWorkspace",
      "aiRules.removeLegacyFoldersWorkspace",
      "aiRules.showCoreStatus",
      "aiRules.refreshTree",
      "aiRules.revealRuleFile",
    ]) {
      assert.ok(commandIds.has(command), `missing command: ${command}`);
    }
  });

  test("sidebar toolbar menus are not gated by host application", () => {
    for (const item of contributions.menus["view/title"]) {
      const when = item.when ?? "";
      assert.ok(!/cursor|vscode|isCursor|isVscode/i.test(when), `unexpected host gate: ${JSON.stringify(item)}`);
    }
  });

  test("does not contribute obsolete multi-rule commands", () => {
    const commandIds = contributions.commands.map((command) => command.command);
    const removedCommands = [
      "aiRules.enableAllGlobal",
      "aiRules.disableAllGlobal",
      "aiRules.applyGlobalToWorkspace",
      "aiRules.toggleIndividualRule",
      // Per-tool folder mirrors were replaced by the AGENTS.md block.
      "aiRules.syncCursorWorkspace",
      "aiRules.syncClineWorkspace",
      "aiRules.syncOpencodeWorkspace",
      "aiRules.syncClaudeWorkspace",
      "aiRules.syncWindsurfWorkspace",
      "aiRules.syncCopilotWorkspace",
      "aiRules.syncAllFormatsWorkspace",
      "aiRules.removeCursorWorkspace",
      "aiRules.removeClineWorkspace",
      "aiRules.removeOpencodeWorkspace",
      "aiRules.removeClaudeWorkspace",
      "aiRules.removeWindsurfWorkspace",
      "aiRules.removeCopilotWorkspace",
      "aiRules.removeAllFormatsWorkspace",
      "aiRules.resetWorkspaceRulesToDefaults",
      "aiRules.hideRuleColors",
    ];

    assert.ok(commandIds.every((command) => !command.startsWith("aiRules.mode")));
    for (const command of removedCommands) {
      assert.ok(!commandIds.includes(command), `obsolete command still contributed: ${command}`);
    }
    assert.equal(contributions.submenus, undefined, "per-tool submenus were removed");
  });

  test("does not contribute obsolete per-tool settings", () => {
    const properties = contributions.configuration.properties;

    for (const settingId of [
      "aiRules.installCursorRulesFolder",
      "aiRules.colorRulesInExplorer",
      "aiRules.autoSyncClineWhenInstalled",
      "aiRules.autoSyncOpencodeWhenInstalled",
      "aiRules.autoSyncClaudeWhenInstalled",
      "aiRules.autoSyncWindsurfWhenInstalled",
      "aiRules.autoSyncCopilotWhenInstalled",
    ]) {
      assert.equal(properties[settingId], undefined, `obsolete setting still contributed: ${settingId}`);
    }
  });

  test("every menu command references a contributed command", () => {
    const commandIds = new Set(contributions.commands.map((command) => command.command));
    const menuCommands = Object.values(contributions.menus)
      .flat()
      .map((item) => item.command)
      .filter(Boolean);

    for (const command of menuCommands) {
      assert.ok(commandIds.has(command), `menu references missing command: ${command}`);
    }
  });

  test("the rule-reveal command is hidden from the command palette", () => {
    const paletteEntries = contributions.menus.commandPalette ?? [];
    const hidden = paletteEntries.find((item) => item.command === "aiRules.revealRuleFile");

    assert.ok(hidden, "aiRules.revealRuleFile needs a commandPalette entry");
    assert.equal(hidden.when, "false");
  });

  test("the sidebar view and welcome content use the runtime tree view identifier", () => {
    const sidebarViews = contributions.views.aiRulesSidebar;
    const welcomeViews = contributions.viewsWelcome.map((welcome) => welcome.view);

    assert.ok(sidebarViews.some((view) => view.id === "aiRules.rulesTree"));
    assert.ok(welcomeViews.includes("aiRules.rulesTree"));
  });

  test("all UI theme color identifiers are contributed", () => {
    const contributedColors = new Set(contributions.colors.map((color) => color.id));

    for (const colorId of Object.values(UI_COLORS)) {
      assert.ok(contributedColors.has(colorId), `missing color contribution: ${colorId}`);
    }
  });

  test("disabled rule color defaults to red in every theme", () => {
    const inactive = contributions.colors.find(
      (color) => color.id === "aiRulebook.inactiveForeground"
    );

    assert.equal(inactive.defaults.dark, "#F85149");
    assert.equal(inactive.defaults.light, "#CF222E");
    assert.equal(inactive.defaults.highContrast, "#F85149");
  });

  test("boolean settings declare boolean defaults", () => {
    const properties = contributions.configuration.properties;
    const booleanSettingIds = [
      "aiRules.autoInstallOnOpenWorkspace",
      "aiRules.promptInstallOnUpdate",
    ];

    assert.deepEqual(Object.keys(properties).sort(), [...booleanSettingIds].sort());

    for (const settingId of booleanSettingIds) {
      assert.equal(properties[settingId].type, "boolean", `${settingId} type`);
      assert.equal(typeof properties[settingId].default, "boolean", `${settingId} default`);
    }
  });
});
