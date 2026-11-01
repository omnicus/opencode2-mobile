import { expect, jest, test } from "@jest/globals";
import type { OpenCodeClient } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { usePermissionReply } from "./followed-projects-queries";
import { openCodeQueryKeys } from "./open-code-query-keys";

const mockReplyPermission = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  replyOpenCodePermissionRequest: (...args: unknown[]) => mockReplyPermission(...args),
}));

const client = {} as OpenCodeClient;
const permissionLocations = new Map([["per_a", { directory: "/a" }]]);

function renderPermissionReply(requestClient: OpenCodeClient | undefined = client) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { gcTime: Infinity, networkMode: "always" } },
  });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => usePermissionReply(queryClient, requestClient, "connection-1", permissionLocations),
    { wrapper },
  );
  return { invalidate, view };
}

test("reports the pending request and then the failed request by ID", async () => {
  let fail!: (error: Error) => void;
  mockReplyPermission.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const { invalidate, view } = renderPermissionReply();
  expect(view.result.current.replyingPermission).toEqual({});
  expect(view.result.current.failedPermissionReply).toEqual({});

  act(() => view.result.current.replyPermission("per_a", "ses_a", "once"));
  await waitFor(() =>
    expect(view.result.current.replyingPermission).toEqual({ replyingPermissionId: "per_a" }),
  );
  expect(mockReplyPermission).toHaveBeenCalledWith(client, "ses_a", "per_a", "once");

  act(() => view.result.current.replyPermission("per_a", "ses_a", "always"));
  expect(mockReplyPermission).toHaveBeenCalledTimes(1);

  await act(async () => fail(new Error("REPLY_FAILED")));
  await waitFor(() =>
    expect(view.result.current.failedPermissionReply).toEqual({
      failedPermissionReplyId: "per_a",
    }),
  );
  expect(view.result.current.replyingPermission).toEqual({});
  expect(invalidate).toHaveBeenCalledWith({
    exact: true,
    queryKey: openCodeQueryKeys.permissions("connection-1", { directory: "/a" }),
  });
  view.unmount();
});

test("ignores replies without a client or a known request location", () => {
  mockReplyPermission.mockReset();
  const missingClient = renderPermissionReply(undefined);
  act(() => missingClient.view.result.current.replyPermission("per_a", "ses_a", "once"));
  missingClient.view.unmount();

  const unknownRequest = renderPermissionReply();
  act(() => unknownRequest.view.result.current.replyPermission("per_missing", "ses_a", "once"));
  unknownRequest.view.unmount();

  expect(mockReplyPermission).not.toHaveBeenCalled();
});
