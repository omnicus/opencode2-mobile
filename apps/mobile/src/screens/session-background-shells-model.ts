import type { SessionMessageInfo, ShellGetOutput } from "@opencode2-mobile/opencode-adapter";

import { sanitizeTranscriptText } from "./session-transcript-model";

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantTool = Extract<AssistantMessage["content"][number], { type: "tool" }>;
type ShellInfo = ShellGetOutput["data"];

export const shellToolNames = new Set(["bash", "command", "exec", "shell", "terminal"]);

export function isShellTool(tool: Pick<AssistantTool, "name">) {
  return shellToolNames.has(tool.name.trim().toLocaleLowerCase());
}

// A shell the transcript says may still run in the background. Whether it does is the
// server's answer, not the transcript's.
export type ShellCandidate = {
  command: string;
  key: string;
  // Its last status refresh failed, so "Running" is only the last known state.
  lastKnown?: boolean;
  shellID: string;
  startedAt?: number;
};

const maxCommandCharacters = 4_096;

// Shell calls that recorded a shellID and were started in, or moved to, the background, in launch
// order. A call that is still running blocks its turn, so it is foreground work and stays in the
// transcript, as in OpenCode desktop and iOS. Terminal metadata means the call already holds the
// shell's final result.
export function shellCandidates(messages: SessionMessageInfo[]): ShellCandidate[] {
  const seen = new Set<string>();
  const newestFirst: ShellCandidate[] = [];
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (let index = message.content.length - 1; index >= 0; index -= 1) {
      const part = message.content[index];
      if (part?.type !== "tool" || !isShellTool(part)) continue;
      const candidate = shellCandidate(part);
      if (!candidate || seen.has(candidate.shellID)) continue;
      seen.add(candidate.shellID);
      newestFirst.push(candidate);
    }
  }
  return newestFirst.reverse();
}

function shellCandidate(tool: AssistantTool): ShellCandidate | undefined {
  if (tool.state.status === "streaming") return undefined;
  const metadata: Record<string, unknown> = isRecord(tool.state.metadata)
    ? tool.state.metadata
    : {};
  const input: Record<string, unknown> = isRecord(tool.state.input) ? tool.state.input : {};
  const shellID = metadata.shellID;
  if (typeof shellID !== "string" || !shellID) return undefined;
  const background = input.background === true || metadata.background === true;
  if (!background && tool.state.status === "running") return undefined;
  if (
    metadata.status === "exited" ||
    metadata.status === "timeout" ||
    metadata.status === "killed"
  ) {
    return undefined;
  }
  const command = [input.command, input.cmd].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return {
    command: command ? sanitizeTranscriptText(command.trim(), maxCommandCharacters) : "Shell",
    key: shellID,
    shellID,
    startedAt: tool.time.ran ?? tool.time.created,
  };
}

// "1 subagent · 2 shells", the way OpenCode desktop summarizes background work.
export function backgroundWorkSummary(subagents: number, shells: number) {
  const parts: string[] = [];
  if (subagents > 0) parts.push(`${subagents} ${subagents === 1 ? "subagent" : "subagents"}`);
  if (shells > 0) parts.push(`${shells} ${shells === 1 ? "shell" : "shells"}`);
  return parts.join(" · ");
}

// How a shell ended, or undefined while it runs or before its status is known. A removed
// shell answers not found, and removing is how a shell is stopped.
export function shellEndLabel(info: ShellInfo | undefined, missing: boolean) {
  if (missing) return "Stopped";
  switch (info?.status) {
    case undefined:
    case "running":
      return undefined;
    case "timeout":
      return "Timed out";
    case "killed":
      return "Stopped";
    case "exited":
      return info.exit === undefined || info.exit === 0
        ? "Exited"
        : `Exited with code ${info.exit}`;
  }
}

export type ShellPageStatus = {
  ended?: string;
  label: string;
  tone: "dim" | "failed" | "running" | "stopped";
};

// What the shell page says about a shell: how it ended, or that it runs. A stale connection or
// a failed refresh is degraded, so a running shell is only "Last known: Running".
export function shellPageStatus(
  snapshot: { info?: ShellInfo | undefined; missing: boolean } | undefined,
  degraded: boolean,
): ShellPageStatus {
  const info = snapshot?.info;
  const ended = snapshot ? shellEndLabel(info, snapshot.missing) : undefined;
  if (!ended) {
    return degraded
      ? { label: "Last known: Running", tone: "dim" }
      : { label: "Running", tone: "running" };
  }
  const failed =
    !snapshot?.missing &&
    (info?.status === "timeout" ||
      (info?.status === "exited" && info.exit !== undefined && info.exit !== 0));
  return {
    ended,
    label: ended,
    tone: failed ? "failed" : ended === "Stopped" ? "stopped" : "dim",
  };
}

export const shellTailLines = 40;

// The last lines of output with escape codes stripped and carriage returns as line breaks.
// clipped says older lines were left out, so the page can say it shows recent output.
export function shellOutputTail(output: string, lines = shellTailLines) {
  const all = sanitizeTranscriptText(output).trimEnd().split("\n");
  return { clipped: all.length > lines, text: all.slice(-lines).join("\n") };
}

const maxSpokenCommandCharacters = 120;

// A command short enough to read aloud or title an alert: its first line, whitespace collapsed.
export function shortShellCommand(command: string) {
  const firstLine = command.split("\n").find((line) => line.trim()) ?? command;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  return collapsed.length > maxSpokenCommandCharacters
    ? `${collapsed.slice(0, maxSpokenCommandCharacters - 1).trimEnd()}…`
    : collapsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
