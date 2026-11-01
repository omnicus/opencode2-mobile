import { maxShellOutputBytes, type ShellGetOutput } from "@opencode2-mobile/opencode-adapter";

export type ShellSnapshot = {
  cursor: number;
  output: string;
  truncated: boolean;
  missing: boolean;
  info?: ShellGetOutput["data"];
};

export function shellRefetchInterval(status: string, snapshot: ShellSnapshot | undefined) {
  return status === "error" ||
    snapshot?.missing ||
    (snapshot?.info && snapshot.info.status !== "running")
    ? false
    : 1_000;
}

// Keep the newest bytes without starting inside a multibyte UTF-8 character.
export function boundShellOutput(output: string, truncated: boolean) {
  const bytes = new TextEncoder().encode(output);
  if (bytes.length <= maxShellOutputBytes) return { output, truncated };
  let start = bytes.length - maxShellOutputBytes;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return { output: new TextDecoder().decode(bytes.slice(start)), truncated: true };
}

export function missingShellSnapshot(previous: ShellSnapshot | undefined): ShellSnapshot {
  return {
    cursor: previous?.cursor ?? 0,
    output: previous?.output ?? "",
    truncated: previous?.truncated ?? false,
    missing: true,
  };
}

export function shellObservationStatus(snapshot: ShellSnapshot | undefined, error: boolean) {
  if (error) return "Shell output could not be refreshed.";
  if (snapshot?.missing) return "Shell output is no longer available on the server.";
  if (!snapshot?.info) return "Loading shell output…";
  switch (snapshot.info.status) {
    case "running":
      return "Running";
    case "timeout":
      return "Timed out";
    case "killed":
      return "Stopped";
    case "exited":
      return `Exited${snapshot.info.exit === undefined ? "" : ` · ${snapshot.info.exit}`}`;
  }
}
