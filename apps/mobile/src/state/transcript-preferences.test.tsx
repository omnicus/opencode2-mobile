import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Button, Text } from "react-native";
import { TranscriptPreferencesProvider, useTranscriptPreferences } from "./transcript-preferences";

const mockRead =
  jest.fn<() => Promise<{ detailed: number; reasoning: number; default_delivery?: string }>>();
const mockWrite = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockDb = { getFirstAsync: mockRead, runAsync: mockWrite };
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));

function Controls() {
  const preferences = useTranscriptPreferences();
  return (
    <>
      <Text>{`${preferences.detailed}/${preferences.reasoning}`}</Text>
      <Text>{preferences.error ? "Save failed" : "OK"}</Text>
      <Text>{preferences.defaultDelivery}</Text>
      <Button
        title="Queue"
        disabled={preferences.busy}
        onPress={() => void preferences.update({ defaultDelivery: "queue" })}
      />
      <Button
        title="Detail"
        disabled={preferences.busy}
        onPress={() => void preferences.update({ detailed: true })}
      />
    </>
  );
}

test("loads device preferences and persists changes while retaining reasoning", async () => {
  mockRead.mockResolvedValue({ detailed: 0, reasoning: 1 });
  mockWrite.mockResolvedValue(undefined);
  render(
    <TranscriptPreferencesProvider>
      <Controls />
    </TranscriptPreferencesProvider>,
  );
  await screen.findByText("false/true");
  await waitFor(() => expect(screen.getByRole("button", { name: "Detail" })).toBeEnabled());
  fireEvent.press(screen.getByRole("button", { name: "Detail" }));
  await screen.findByText("true/true");
  expect(mockWrite).toHaveBeenLastCalledWith(
    expect.stringContaining("UPDATE transcript_preferences"),
    1,
    1,
    "steer",
  );
});

test("failed persistence keeps the previous preference and allows retry", async () => {
  mockRead.mockResolvedValue({ detailed: 0, reasoning: 0 });
  mockWrite.mockRejectedValueOnce(new Error("disk"));
  render(
    <TranscriptPreferencesProvider>
      <Controls />
    </TranscriptPreferencesProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Detail" })).toBeEnabled());
  fireEvent.press(screen.getByRole("button", { name: "Detail" }));
  await screen.findByText("Save failed");
  expect(screen.getByText("false/false")).toBeOnTheScreen();
  mockWrite.mockResolvedValue(undefined);
  fireEvent.press(screen.getByRole("button", { name: "Detail" }));
  await screen.findByText("true/false");
});

test("defaults to steer and saves queue while retaining transcript preferences", async () => {
  mockRead.mockResolvedValue({ detailed: 1, reasoning: 1, default_delivery: "steer" });
  mockWrite.mockResolvedValue(undefined);
  render(
    <TranscriptPreferencesProvider>
      <Controls />
    </TranscriptPreferencesProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Queue" })).toBeEnabled());
  expect(screen.getByText("steer")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Queue" }));
  await screen.findByText("queue");
  expect(mockWrite).toHaveBeenLastCalledWith(
    expect.stringContaining("default_delivery"),
    1,
    1,
    "queue",
  );
});

test("restores the queue default after relaunch", async () => {
  mockRead.mockResolvedValue({ detailed: 0, reasoning: 0, default_delivery: "queue" });
  render(
    <TranscriptPreferencesProvider>
      <Controls />
    </TranscriptPreferencesProvider>,
  );
  await screen.findByText("queue");
});
