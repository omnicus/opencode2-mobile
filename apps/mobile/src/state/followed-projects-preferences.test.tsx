import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { SQLiteDatabase } from "expo-sqlite";

import type { SessionInboxPreferences } from "../storage/session-inbox-repository";
import { useSessionInboxPreferences } from "./followed-projects-preferences";

const mockStartSessionInbox = jest.fn<(...args: unknown[]) => Promise<SessionInboxPreferences>>();
const mockWriteInboxSectionExpanded = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@opencode2-mobile/opencode-adapter", () => ({}));
jest.mock("../storage/session-inbox-repository", () => ({
  startSessionInbox: (...args: unknown[]) => mockStartSessionInbox(...args),
  writeInboxSectionExpanded: (...args: unknown[]) => mockWriteInboxSectionExpanded(...args),
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
  mockWriteInboxSectionExpanded.mockReset();
  mockWriteInboxSectionExpanded.mockResolvedValue(undefined);
});

test("starts the inbox for the connection and stores the Working and Archived sections", async () => {
  mockStartSessionInbox.mockResolvedValue({
    archivedExpanded: true,
    sinceMs: 1_000,
    workingExpanded: false,
  });
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00005",
    connectionUpdatedAtMs: 5,
  });
  expect(view.result.current.inboxSinceMs).toBeUndefined();
  expect(view.result.current.workingExpanded).toBe(true);
  expect(view.result.current.archivedExpanded).toBe(true);

  await waitFor(() => expect(view.result.current.inboxSinceMs).toBe(1_000));
  expect(view.result.current.workingExpanded).toBe(false);
  expect(mockStartSessionInbox).toHaveBeenCalledWith(db, "connection-1", 5, expect.any(Number));

  act(() => view.result.current.setSectionExpanded("working", true));
  expect(view.result.current.workingExpanded).toBe(true);
  expect(mockWriteInboxSectionExpanded).toHaveBeenCalledWith(
    db,
    "connection-1",
    5,
    "working",
    true,
  );

  act(() => view.result.current.setSectionExpanded("archived", false));
  expect(view.result.current.archivedExpanded).toBe(false);
  expect(view.result.current.workingExpanded).toBe(true);
  expect(mockWriteInboxSectionExpanded).toHaveBeenLastCalledWith(
    db,
    "connection-1",
    5,
    "archived",
    false,
  );
  view.unmount();
});

test("starts the inbox now when the device cannot store it", async () => {
  mockStartSessionInbox.mockRejectedValue(new Error("SESSION_INBOX_NOT_STARTED"));
  mockWriteInboxSectionExpanded.mockRejectedValue(new Error("CONNECTION_PROFILE_CHANGED"));
  const before = Date.now();
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00005",
    connectionUpdatedAtMs: 5,
  });

  await waitFor(() => expect(view.result.current.inboxSinceMs).toBeGreaterThanOrEqual(before));
  expect(view.result.current.workingExpanded).toBe(true);

  act(() => view.result.current.setSectionExpanded("working", false));
  expect(view.result.current.workingExpanded).toBe(false);
  view.unmount();
});

test("waits for a stored connection before starting the inbox", () => {
  const view = renderInboxPreferences({
    connectionID: "connection-1",
    connectionKey: "connection-1\u00000",
    connectionUpdatedAtMs: undefined,
  });

  act(() => view.result.current.setSectionExpanded("working", false));
  expect(view.result.current.inboxSinceMs).toBeUndefined();
  expect(view.result.current.workingExpanded).toBe(true);
  expect(mockStartSessionInbox).not.toHaveBeenCalled();
  expect(mockWriteInboxSectionExpanded).not.toHaveBeenCalled();

  view.rerender({ connectionID: undefined, connectionKey: undefined, connectionUpdatedAtMs: 5 });
  act(() => view.result.current.setSectionExpanded("working", false));
  expect(mockStartSessionInbox).not.toHaveBeenCalled();
  expect(mockWriteInboxSectionExpanded).not.toHaveBeenCalled();
  view.unmount();
});

test("drops an inbox start that lands after the connection changes", async () => {
  let finish!: (preferences: SessionInboxPreferences) => void;
  mockStartSessionInbox.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockStartSessionInbox.mockResolvedValueOnce({
    archivedExpanded: true,
    sinceMs: 2_000,
    workingExpanded: true,
  });
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

  await act(async () =>
    finish({ archivedExpanded: false, sinceMs: 1_000, workingExpanded: false }),
  );
  expect(view.result.current.inboxSinceMs).toBe(2_000);
  expect(view.result.current.workingExpanded).toBe(true);
  view.unmount();
});
