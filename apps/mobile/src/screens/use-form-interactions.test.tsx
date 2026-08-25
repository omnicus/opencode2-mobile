import { beforeEach, expect, jest, test } from "@jest/globals";
import type { FormInfo, FormState, LocationRef } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { formStateQueryKey, orderFormRequests, useFormInteractions } from "./use-form-interactions";

const mockCancelForm = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockGetFormState = jest.fn<(...args: unknown[]) => Promise<FormState>>();
const mockReplyForm = jest.fn<(...args: unknown[]) => Promise<void>>();
const client = {};
const location = { directory: "/workspace" } satisfies LocationRef;
const form = {
  fields: [{ key: "name", required: true, type: "string" }],
  id: "frm_a",
  sessionID: "ses_a",
  title: "Name",
} satisfies FormInfo;

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  cancelOpenCodeForm: (...args: unknown[]) => mockCancelForm(...args),
  getOpenCodeFormState: (...args: unknown[]) => mockGetFormState(...args),
  replyOpenCodeForm: (...args: unknown[]) => mockReplyForm(...args),
}));

beforeEach(() => {
  mockCancelForm.mockReset();
  mockGetFormState.mockReset();
  mockReplyForm.mockReset();
  mockCancelForm.mockResolvedValue(undefined);
  mockGetFormState.mockResolvedValue({ status: "pending" });
  mockReplyForm.mockResolvedValue(undefined);
});

test("orders requests by owning session and stable form ID", () => {
  const forms = [{ ...form, id: "frm_b", sessionID: "ses_b" }, { ...form, id: "frm_c" }, form];
  expect(orderFormRequests(forms).map((candidate) => candidate.id)).toEqual([
    "frm_a",
    "frm_c",
    "frm_b",
  ]);
  expect(forms.map((candidate) => candidate.id)).toEqual(["frm_b", "frm_c", "frm_a"]);
});

test("replies and reconciles list and state after the mutation settles", async () => {
  let state: FormState = { status: "pending" };
  mockGetFormState.mockImplementation(async () => state);
  mockReplyForm.mockImplementation(async () => {
    state = { answer: { name: "Ada" }, status: "answered" };
  });
  const queryClient = createQueryClient();
  const hook = renderHook(
    () =>
      useFormInteractions({
        client: client as never,
        connectionId: "connection-1",
        forms: [form],
        location,
      }),
    { wrapper: wrapper(queryClient) },
  );

  await waitFor(() => expect(mockGetFormState).toHaveBeenCalled());
  act(() => hook.result.current.replyForm(form, { name: "Ada" }));
  await waitFor(() =>
    expect(mockReplyForm).toHaveBeenCalledWith(client, "ses_a", "frm_a", { name: "Ada" }),
  );
  await waitFor(() => expect(hook.result.current.forms).toEqual([]));
  expect(queryClient.getQueryData(formStateQueryKey("connection-1", location, form))).toEqual({
    answer: { name: "Ada" },
    status: "answered",
  });
  hook.unmount();
  queryClient.clear();
});

test("removes a request after another client completes it", async () => {
  let state: FormState = { status: "pending" };
  mockGetFormState.mockImplementation(async () => state);
  const queryClient = createQueryClient();
  const hook = renderHook(
    () =>
      useFormInteractions({
        client: client as never,
        connectionId: "connection-1",
        forms: [form],
        location,
      }),
    { wrapper: wrapper(queryClient) },
  );

  await waitFor(() => expect(hook.result.current.forms).toHaveLength(1));
  state = { status: "cancelled" };
  await act(() =>
    queryClient.invalidateQueries({
      exact: true,
      queryKey: formStateQueryKey("connection-1", location, form),
    }),
  );
  await waitFor(() => expect(hook.result.current.forms).toEqual([]));
  hook.unmount();
  queryClient.clear();
});

test("reconciles forms against their exact locations", async () => {
  const secondForm = { ...form, id: "frm_b", sessionID: "ses_b" };
  const secondLocation = { directory: "/workspace-b", workspaceID: "wrk_b" };
  const queryClient = createQueryClient();
  const hook = renderHook(
    () =>
      useFormInteractions({
        client: client as never,
        connectionId: "connection-1",
        formLocations: new Map([
          [form.id, location],
          [secondForm.id, secondLocation],
        ]),
        forms: [secondForm, form],
        location: undefined,
      }),
    { wrapper: wrapper(queryClient) },
  );

  await waitFor(() => expect(mockGetFormState).toHaveBeenCalledTimes(2));
  act(() => hook.result.current.cancelForm(secondForm));
  await waitFor(() => expect(mockCancelForm).toHaveBeenCalledWith(client, "ses_b", "frm_b"));
  expect(
    queryClient.getQueryState(formStateQueryKey("connection-1", secondLocation, secondForm)),
  ).toBeDefined();
  hook.unmount();
  queryClient.clear();
});

test("keeps a failed request visible and reports its ID after reconciliation", async () => {
  mockCancelForm.mockRejectedValue(new Error("conflict"));
  const queryClient = createQueryClient();
  const hook = renderHook(
    () =>
      useFormInteractions({
        client: client as never,
        connectionId: "connection-1",
        forms: [form],
        location,
      }),
    { wrapper: wrapper(queryClient) },
  );

  await waitFor(() => expect(hook.result.current.forms).toHaveLength(1));
  act(() => hook.result.current.cancelForm(form));
  await waitFor(() => expect(hook.result.current.errorFormId).toBe("frm_a"));
  expect(hook.result.current.forms).toEqual([form]);
  hook.unmount();
  queryClient.clear();
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Infinity, retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
