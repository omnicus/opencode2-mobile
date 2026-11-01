import { classifyOpenCodeError, type McpServer } from "@opencode2-mobile/opencode-adapter";

export type BranchCopyState = "idle" | "copied" | "error";
export type McpServerChange = { server: string; connect: boolean };
type RequestState = { isError: boolean; error: unknown };

export const branchCopyLabels: Record<BranchCopyState, string> = {
  idle: "Copy branch name",
  copied: "Copied",
  error: "Try copying again",
};

const mcpStatusLabels: Record<McpServer["status"]["status"], string> = {
  connected: "Connected",
  pending: "Connecting",
  disabled: "Disconnected",
  failed: "Connection failed",
  needs_auth: "Needs authentication",
};

function incompatible({ isError, error }: RequestState) {
  return isError && classifyOpenCodeError(error) === "INCOMPATIBLE";
}

export function mcpManagementUnsupported(query: RequestState, mutation: RequestState) {
  return incompatible(query) || incompatible(mutation);
}

// The 10-second poll must not flicker the switches; only the first load and a change block them.
export function mcpChangesAllowed(
  available: boolean,
  servers: McpServer[] | undefined,
  mutationPending: boolean,
  unsupported: boolean,
) {
  return available && servers !== undefined && !mutationPending && !unsupported;
}

// Enabled is distinct from connected. An enabled server can still be
// connecting, require authentication, or have a connection failure.
export function mcpServerRowState(server: McpServer, change: McpServerChange | undefined) {
  const enabled = server.status.status !== "disabled";
  if (change?.server !== server.name)
    return {
      enabled,
      checked: enabled,
      pending: false,
      status: mcpStatusLabels[server.status.status],
    };
  return {
    enabled,
    checked: change.connect,
    pending: true,
    status: change.connect ? "Connecting" : "Disconnecting",
  };
}
