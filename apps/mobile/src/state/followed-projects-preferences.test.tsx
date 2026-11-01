import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { SQLiteDatabase } from "expo-sqlite";

import type { SessionInboxPreferences } from "../storage/session-inbox-repository";
import { useSessionInboxPreferences } from "./followed-projects-preferences";

const mockStartSessionInbox = jest.fn<(...args: unknown[]) => Promise<SessionInboxPreferences>>();
const mockWriteWorkingShelfExpanded = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@opencode2-mobile/opencode-adapter", () => ({}));
jest.mock("../storage/session-inbox-repository", () => ({
  startSessionInbox: (...args: unknown[]) => mockStartSessionInbox(...args),
  writeWorkingShelfExpanded: (...args: unknown[]) => mockWriteWorkingShelfExpanded(...args),
}));

const db = {} as SQLiteDatabase;

type Props = {
  connectionID: string | undefined;
  connectionKey: string | undefined;
  connectionUpdatedAtMs: number | undefined;
};

function renderInboxPreferences(initialProps: Props) {
  return renderHook(
    ({ connectionID, connectionKey, connectionUpdatedAtMs }: Props) =>
      useSessionInboxPreferences(db, connectionID, connectionKey, connectionUpdatedAtMs),
    { initialProps },
  );
}

beforeEach(() => {
  mockStartSessionInbox.mockReset();
  mockWriteWorkingShelfExpanded.mockReset();
  mockWriteWorkingShelfExpanded.mockResolvedValue(undefined);
});

test("starts the inbox for the connection and stores the Working shelf", async () => {
  mockStartSessionInbox.mockResolvedValue({ sinceMs: 1_000, workingExpanded: false });
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00005",
    connectionUpdatedAtMs: 5,
  });
  expect(view.result.current.inboxSinceMs).toBeUndefined();
  expect(view.result.current.workingExpanded).toBe(true);

  await waitFor(() => expect(view.result.current.inboxSinceMs).toBe(1_000));
  expect(view.result.current.workingExpanded).toBe(false);
  expect(mockStartSessionInbox).toHaveBeenCalledWith(db, "connection-1", 5, expect.any(Number));

  act(() => view.result.current.setWorkingExpanded(true));
  expect(view.result.current.workingExpanded).toBe(true);
  expect(mockWriteWorkingShelfExpanded).toHaveBeenCalledWith(db, "connection-1", 5, true);
  view.unmount();
});

test("starts the inbox now when the device cannot store it", async () => {
  mockStartSessionInbox.mockRejectedValue(new Error("SESSION_INBOX_NOT_STARTED"));
  mockWriteWorkingShelfExpanded.mockRejectedValue(new Error("CONNECTION_PROFILE_CHANGED"));
  const before = Date.now();
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00005",
    connectionUpdatedAtMs: 5,
  });

  await waitFor(() => expect(view.result.current.inboxSinceMs).toBeGreaterThanOrEqual(before));
  expect(view.result.current.workingExpanded).toBe(true);

  act(() => view.result.current.setWorkingExpanded(false));
  expect(view.result.current.workingExpanded).toBe(false);
  view.unmount();
});

test("waits for a stored connection before starting the inbox", () => {
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00000",
    connectionUpdatedAtMs: undefined,
  });

  act(() => view.result.current.setWorkingExpanded(false));
  expect(view.result.current.inboxSinceMs).toBeUndefined();
  expect(view.result.current.workingExpanded).toBe(true);
  expect(mockStartSessionInbox).not.toHaveBeenCalled();
  expect(mockWriteWorkingShelfExpanded).not.toHaveBeenCalled();

  view.rerender({ connectionID: undefined, connectionKey: undefined, connectionUpdatedAtMs: 5 });
  act(() => view.result.current.setWorkingExpanded(false));
  expect(mockStartSessionInbox).not.toHaveBeenCalled();
  expect(mockWriteWorkingShelfExpanded).not.toHaveBeenCalled();
  view.unmount();
});

test("drops an inbox start that lands after the connection changes", async () => {
  let finish!: (preferences: SessionInboxPreferences) => void;
  mockStartSessionInbox.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockStartSessionInbox.mockResolvedValueOnce({ sinceMs: 2_000, workingExpanded: true });
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00005",
    connectionUpdatedAtMs: 5,
  });
  view.rerender({
    connectionID: "connection-2",
    connectionKey: "connection-2\u00006",
    connectionUpdatedAtMs: 6,
  });
  await waitFor(() => expect(view.result.current.inboxSinceMs).toBe(2_000));

  await act(async () => finish({ sinceMs: 1_000, workingExpanded: false }));
  expect(view.result.current.inboxSinceMs).toBe(2_000);
  expect(view.result.current.workingExpanded).toBe(true);
  view.unmount();
});
