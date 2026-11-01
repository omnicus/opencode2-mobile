import {
  getDefaultOpenCodeAgent,
  getDefaultOpenCodeModel,
  type LocationRef,
  listActiveOpenCodeSessions,
  listOpenCodeAgents,
  listOpenCodeCommands,
  listOpenCodeModels,
  listOpenCodeSessionInbox,
  listOpenCodeSkills,
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useQuery } from "@tanstack/react-query";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { listUnresolvedPromptAdmissions } from "../storage/prompt-admission-repository";
import type { PromptAdmission } from "./prompt-admission-model";
import {
  mentionableAgents,
  modelRef,
  primaryAgents,
  resolveSessionAgent,
  selectableModels,
} from "./session-execution-model";
import { hasForegroundBackgroundableTool } from "./session-transcript-model";
import type { SessionExecutionRuntime } from "./use-session-execution-runtime";

export type SessionExecutionQueries = ReturnType<typeof useSessionExecutionQueries>;

export function useSessionExecutionQueries(
  {
    client,
    db,
    enabled,
    inboxKey,
    admissionKey,
    scopedConnectionId,
    sessionID,
  }: SessionExecutionRuntime,
  location: LocationRef,
) {
  const admissionsQuery = useQuery<PromptAdmission[]>({
    enabled,
    queryFn: () => listUnresolvedPromptAdmissions(db, scopedConnectionId, sessionID),
    queryKey: admissionKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const activeSessionsQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) => listActiveOpenCodeSessions(ready, { signal })),
    queryKey: openCodeQueryKeys.activeSessions(scopedConnectionId),
  });
  const inboxQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      listOpenCodeSessionInbox(ready, sessionID, { signal }),
    ),
    queryKey: inboxKey,
  });
  const agentsQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      listOpenCodeAgents(ready, location, { signal }),
    ),
    queryKey: openCodeQueryKeys.agents(scopedConnectionId, location),
  });
  const commandsQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      listOpenCodeCommands(ready, location, { signal }),
    ),
    queryKey: openCodeQueryKeys.commands(scopedConnectionId, location),
  });
  const modelsQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      listOpenCodeModels(ready, location, { signal }),
    ),
    queryKey: openCodeQueryKeys.models(scopedConnectionId, location),
  });
  const skillsQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      listOpenCodeSkills(ready, location, { signal }),
    ),
    queryKey: openCodeQueryKeys.skills(scopedConnectionId, location),
  });
  const defaultModelQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      getDefaultOpenCodeModel(ready, location, { signal }),
    ),
    queryKey: [...openCodeQueryKeys.models(scopedConnectionId, location), "default"],
  });
  const defaultAgentQuery = useQuery({
    enabled,
    queryFn: clientQuery(client, (ready, signal) =>
      getDefaultOpenCodeAgent(ready, location, { signal }),
    ),
    queryKey: [...openCodeQueryKeys.agents(scopedConnectionId, location), "default"],
  });
  return {
    activeSessionsQuery,
    admissionsQuery,
    agentsQuery,
    commandsQuery,
    defaultAgentQuery,
    defaultModelQuery,
    inboxQuery,
    modelsQuery,
    skillsQuery,
  };
}

export function clientQuery<T>(
  client: OpenCodeClient | undefined,
  load: (client: OpenCodeClient, signal: AbortSignal) => Promise<T>,
) {
  return ({ signal }: { signal: AbortSignal }) => {
    if (!client) throw new Error("CONNECTION_NOT_READY");
    return load(client, signal);
  };
}

export function executionActivity(
  { activeSessionsQuery, admissionsQuery, inboxQuery }: SessionExecutionQueries,
  {
    enabled,
    messages,
    sessionID,
  }: { enabled: boolean; messages: SessionMessageInfo[]; sessionID: string },
) {
  const active = Boolean(activeSessionsQuery.data?.[sessionID]);
  const canBackground =
    enabled && active && !activeSessionsQuery.isError && hasForegroundBackgroundableTool(messages);
  const executionStateReady = activeSessionsQuery.isSuccess && inboxQuery.isSuccess;
  const inbox = inboxQuery.data ?? [];
  const admissions = admissionsQuery.data ?? [];
  return { active, admissions, canBackground, executionStateReady, inbox };
}

export function executionAgents(
  { agentsQuery, defaultAgentQuery, defaultModelQuery, modelsQuery }: SessionExecutionQueries,
  session: SessionInfo | undefined,
) {
  const agents = primaryAgents(agentsQuery.data?.data ?? []);
  const models = selectableModels(modelsQuery.data?.data ?? []);
  const selectedAgent = resolveSessionAgent(
    session?.agent,
    defaultAgentQuery.data,
    agents.map((agent) => agent.id),
  );
  const selectedAgentInfo = agents.find((agent) => agent.id === selectedAgent);
  return {
    agents,
    models,
    selectedAgent,
    selectedModel:
      session?.model ?? selectedAgentInfo?.model ?? modelRef(defaultModelQuery.data?.data),
  };
}

export function executionCatalog({
  agentsQuery,
  commandsQuery,
  defaultModelQuery,
  modelsQuery,
  skillsQuery,
}: SessionExecutionQueries) {
  return {
    commands: commandsQuery.data?.data ?? [],
    completionLoading: commandsQuery.isPending,
    completionUnavailable: commandsQuery.isError,
    agentCatalog: {
      loading: agentsQuery.isPending,
      error: agentsQuery.isError,
      retry: () => {
        void agentsQuery.refetch();
      },
    },
    modelCatalog: {
      loading: modelsQuery.isPending,
      error: modelsQuery.isError,
      retry: () => {
        void modelsQuery.refetch();
      },
    },
    defaultModel: defaultModelQuery.data?.data ?? undefined,
    mentionAgents: mentionableAgents(agentsQuery.data?.data ?? []),
    mentionLoading: agentsQuery.isPending || skillsQuery.isPending,
    mentionUnavailable: agentsQuery.isError || skillsQuery.isError,
    skills: skillsQuery.data?.data ?? [],
  };
}

export async function reconcileExecution(
  { activeSessionsQuery, inboxQuery }: SessionExecutionQueries,
  refetchMessages: () => Promise<unknown>,
) {
  await Promise.all([activeSessionsQuery.refetch(), inboxQuery.refetch(), refetchMessages()]).catch(
    () => undefined,
  );
}
