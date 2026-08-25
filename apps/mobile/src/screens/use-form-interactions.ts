import {
  cancelOpenCodeForm,
  type FormAnswer,
  type FormInfo,
  type FormState,
  getOpenCodeFormState,
  type LocationRef,
  type listOpenCodeFormRequests,
  type OpenCodeClient,
  replyOpenCodeForm,
} from "@opencode2-mobile/opencode-adapter";
import { type QueryKey, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";

import { openCodeQueryKeys } from "../state/open-code-query-keys";

type FormListOutput = Awaited<ReturnType<typeof listOpenCodeFormRequests>>;

type FormMutationVariables = {
  client: OpenCodeClient;
  form: FormInfo;
  listKey: QueryKey;
  stateKey: QueryKey;
} & ({ answer: FormAnswer; action: "reply" } | { action: "cancel" });

export function useFormInteractions({
  client,
  connectionId,
  formLocations,
  forms,
  location,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  formLocations?: ReadonlyMap<string, LocationRef>;
  forms: readonly FormInfo[];
  location: LocationRef | undefined;
}) {
  const queryClient = useQueryClient();
  const orderedForms = orderFormRequests(forms);
  const stateQueries = useQueries({
    queries: orderedForms.map((form) => {
      const formLocation = formLocations?.get(form.id) ?? location;
      return {
        enabled: Boolean(client && connectionId && formLocation),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!client) throw new Error("CONNECTION_NOT_READY");
          return getOpenCodeFormState(client, form.sessionID, form.id, { signal });
        },
        queryKey: formStateQueryKey(connectionId ?? "unselected", formLocation, form),
      };
    }),
  });
  const pendingForms = orderedForms.filter((_, index) => {
    const state = stateQueries[index]?.data as FormState | undefined;
    return state?.status !== "answered" && state?.status !== "cancelled";
  });

  const mutation = useMutation({
    mutationFn: async (variables: FormMutationVariables) => {
      if (variables.action === "reply") {
        await replyOpenCodeForm(
          variables.client,
          variables.form.sessionID,
          variables.form.id,
          variables.answer,
        );
      } else {
        await cancelOpenCodeForm(variables.client, variables.form.sessionID, variables.form.id);
      }
    },
    onSettled: (_data, _error, variables) => {
      void Promise.all([
        queryClient.invalidateQueries({ exact: true, queryKey: variables.listKey }),
        queryClient.invalidateQueries({ exact: true, queryKey: variables.stateKey }),
      ]);
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<FormListOutput>(variables.listKey, (current) =>
        current
          ? {
              ...current,
              data: current.data.filter((form) => form.id !== variables.form.id),
            }
          : current,
      );
      queryClient.setQueryData<FormState>(
        variables.stateKey,
        variables.action === "reply"
          ? { answer: variables.answer, status: "answered" }
          : { status: "cancelled" },
      );
    },
  });

  function mutate(form: FormInfo, action: FormMutationVariables["action"], answer?: FormAnswer) {
    const formLocation = formLocations?.get(form.id) ?? location;
    if (!client || !connectionId || !formLocation || mutation.isPending) return;
    const common = {
      client,
      form,
      listKey: openCodeQueryKeys.forms(connectionId, formLocation),
      stateKey: formStateQueryKey(connectionId, formLocation, form),
    };
    mutation.mutate(
      action === "reply" ? { ...common, action, answer: answer ?? {} } : { ...common, action },
    );
  }

  return {
    busyFormId: mutation.isPending ? mutation.variables?.form.id : undefined,
    cancelForm: (form: FormInfo) => mutate(form, "cancel"),
    errorFormId: mutation.isError ? mutation.variables?.form.id : undefined,
    forms: pendingForms,
    replyForm: (form: FormInfo, answer: FormAnswer) => mutate(form, "reply", answer),
  };
}

export function formStateQueryKey(
  connectionId: string,
  location: LocationRef | undefined,
  form: Pick<FormInfo, "id" | "sessionID">,
) {
  const listKey = openCodeQueryKeys.forms(
    connectionId,
    location ?? { directory: "__unresolved__" },
  );
  return [...listKey, "state", form.sessionID, form.id] as const;
}

export function orderFormRequests(forms: readonly FormInfo[]) {
  return [...forms].sort(
    (first, second) =>
      first.sessionID.localeCompare(second.sessionID) || first.id.localeCompare(second.id),
  );
}
