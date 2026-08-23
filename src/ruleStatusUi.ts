import * as vscode from "vscode";
import { isRuleEnabled } from "./rulesOperations";

export function createAiRulesOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("AI Rulebook");
}

/**
 * Writes rule-pack state (active vs off) as plain text into the
 * "AI Rulebook" Output channel. Visual highlighting (green for active, red for
 * disabled) lives in the sidebar tree via the file decoration provider; the
 * Output channel is a plain-text log, so we deliberately avoid ANSI escapes
 * here—VS Code does not render them and they show up as `[32m...` literals.
 */
export async function showRulePackStatusInOutput(
  channel: vscode.OutputChannel,
  rulesDir: string,
  mdcs: readonly string[]
): Promise<void> {
  channel.clear();
  channel.appendLine("AI Rulebook — rule pack");
  channel.appendLine("(open the AI Rulebook sidebar to see colored on/off state)");
  channel.appendLine("");
  for (const f of mdcs) {
    const on = await isRuleEnabled(rulesDir, f);
    channel.appendLine(`${on ? "active" : "off   "}\t${f}`);
  }
  channel.appendLine("");
  channel.appendLine("active = loaded by Cursor; off = `.mdc.disabled` on disk.");
}
