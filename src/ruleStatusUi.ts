import * as vscode from "vscode";
import { AGENTS_MD, isRuleEnabledInAgentsMd } from "./agentsMd";

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
  workspaceRoot: string,
  mdcs: readonly string[]
): Promise<void> {
  channel.clear();
  channel.appendLine(`AI Rulebook — rule pack in ${AGENTS_MD}`);
  channel.appendLine("(open the AI Rulebook sidebar to see colored on/off state)");
  channel.appendLine("");
  for (const f of mdcs) {
    const on = await isRuleEnabledInAgentsMd(workspaceRoot, f);
    channel.appendLine(`${on ? "active" : "off   "}\t${f}`);
  }
  channel.appendLine("");
  channel.appendLine(
    `active = text present in ${AGENTS_MD}; off = section kept but its text removed.`
  );
}
