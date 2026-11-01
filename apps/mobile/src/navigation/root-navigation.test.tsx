import { beforeEach, expect, jest, test } from "@jest/globals";
import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { RootNavigation, type RootStackParamList } from "./root-navigation";

let mockConnections: {
  error?: string;
  profiles: { id: string }[];
  ready: boolean;
};
let mockPendingCount = 0;
let mockTablet = false;

type HostNode = { props: Record<string, unknown>; type: unknown };

jest.mock("../connections/connections-context", () => ({
  useConnections: () => mockConnections,
}));
jest.mock("../screens/app-shell", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ConnectionStorageFailureScreen: () => <Text>Connection storage failed</Text>,
    ConnectionStorageLoadingScreen: () => <Text>Connection storage loading</Text>,
    isTabletShell: () => mockTablet,
    PendingInteractionsScreen: () => <Text>Pending screen</Text>,
    SettingsScreen: () => <Text>Settings screen</Text>,
  };
});
jest.mock("../screens/followed-projects-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { FollowedProjectsScreen: () => <Text>Followed projects screen</Text> };
});
jest.mock("../screens/diff-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { DiffScreen: () => <Text>Diff screen</Text> };
});
jest.mock("../screens/new-session-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { NewSessionScreen: () => <Text>New session screen</Text> };
});
jest.mock("@expo/vector-icons/Feather", () => () => null);
jest.mock("../state/workspace-selection-context", () => ({
  useWorkspaceSelection: () => ({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: mockPendingCount,
  }),
}));
jest.mock("../screens/workspace-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    SessionScreen: () => <Text>Session screen</Text>,
    WorkspaceScreen: () => <Text>Workspace shell</Text>,
  };
});
jest.mock("../screens/connection-screen", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ConnectionScreen: ({ onDone, onPair }: { onDone?: () => void; onPair?: () => void }) => (
      <>
        <Pressable accessibilityRole="button" onPress={onDone}>
          <Text>Connection manager</Text>
        </Pressable>
        {onPair ? (
          <Pressable accessibilityRole="button" onPress={onPair}>
            <Text>Scan pairing code</Text>
          </Pressable>
        ) : null}
      </>
    ),
  };
});
jest.mock("../screens/notification-pairing-screen", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    NotificationPairingScreen: ({ onDone }: { onDone: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onDone}>
        <Text>Notification pairing</Text>
      </Pressable>
    ),
  };
});

beforeEach(() => {
  mockConnections = { profiles: [], ready: true };
  mockPendingCount = 0;
  mockTablet = false;
});

test("shows loading, failure, and first-run onboarding gates", () => {
  mockConnections = { profiles: [], ready: false };
  const view = render(
    <NavigationContainer>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(screen.getByText("Connection storage loading")).toBeOnTheScreen();

  mockConnections = { error: "failed", profiles: [], ready: true };
  view.rerender(
    <NavigationContainer>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(screen.getByText("Connection storage failed")).toBeOnTheScreen();

  mockConnections = { profiles: [], ready: true };
  view.rerender(
    <NavigationContainer>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(screen.getByText("Connection manager")).toBeOnTheScreen();
});

test("keeps duplicate actions out of the workspace header and preserves management routes", async () => {
  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <NavigationContainer ref={navigation}>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();

  expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
  act(() => navigation.navigate("NewSession"));
  expect(await screen.findByText("New session screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
  await screen.findByText("Workspace shell");

  expect(screen.queryByRole("button", { name: "Workspace options" })).toBeNull();
  act(() => navigation.navigate("Connections"));
  expect(await screen.findByText("Connection manager")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Connection manager" }));
  expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();
});

test("pushes session detail and presents workspace management routes over it", async () => {
  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
  mockPendingCount = 1;
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <NavigationContainer ref={navigation}>
      <RootNavigation />
    </NavigationContainer>,
  );
  await screen.findByText("Workspace shell");

  act(() =>
    navigation.navigate("Session", {
      connectionId: "connection-1",
      location: { directory: "/workspace" },
      sessionID: "ses_test",
    }),
  );
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Workspace options" })).toBeNull();
  expect(
    screen.getByTestId("session-attention-marker", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Needs you" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Back to Sessions" }));
  expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();
  expect(screen.queryByText("Pending screen")).toBeNull();
  act(() =>
    navigation.navigate("Session", {
      connectionId: "connection-1",
      location: { directory: "/workspace" },
      sessionID: "ses_test",
    }),
  );
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();

  act(() =>
    navigation.navigate("Diff", {
      connectionId: "connection-1",
      location: { directory: "/workspace" },
      mode: "working",
    }),
  );
  expect(await screen.findByText("Diff screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();

  act(() => navigation.navigate("NewSession"));
  expect(await screen.findByText("New session screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();

  act(() => navigation.navigate("Pending"));
  expect(await screen.findByText("Pending screen")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();

  act(() => navigation.navigate("FollowedProjects"));
  expect(await screen.findByText("Followed projects screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();

  act(() => navigation.navigate("Settings"));
  expect(await screen.findByText("Settings screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();
});

test("presents first-run pairing as a modal that returns to first run", async () => {
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <NavigationContainer ref={navigation}>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(await screen.findByText("Connection manager")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Scan pairing code" }));
  expect(await screen.findByText("Notification pairing")).toBeOnTheScreen();
  expect(navigation.getCurrentRoute()?.name).toBe("Pairing");
  act(() => navigation.goBack());
  expect(await screen.findByText("Connection manager")).toBeOnTheScreen();
  expect(navigation.getCurrentRoute()?.name).toBe("Connections");

  fireEvent.press(screen.getByRole("button", { name: "Scan pairing code" }));
  fireEvent.press(await screen.findByRole("button", { name: "Notification pairing" }));
  expect(await screen.findByText("Connection manager")).toBeOnTheScreen();
});

test("hands over to the main stack once a profile exists", async () => {
  const view = render(
    <NavigationContainer>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(await screen.findByText("Connection manager")).toBeOnTheScreen();

  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
  view.rerender(
    <NavigationContainer>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();
});

test("keeps the title and Done on management modals on tablets", async () => {
  mockTablet = true;
  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <NavigationContainer ref={navigation}>
      <RootNavigation />
    </NavigationContainer>,
  );
  await screen.findByText("Workspace shell");

  for (const [route, body, title] of [
    ["Settings", "Settings screen", "Settings"],
    ["Pending", "Pending screen", "Needs you"],
    ["FollowedProjects", "Followed projects screen", "Followed projects"],
  ] as const) {
    act(() => navigation.navigate(route));
    expect(await screen.findByText(body)).toBeOnTheScreen();
    const header = screen.UNSAFE_root.findAll(
      (node: HostNode) => typeof node.type === "string" && node.props.title === title,
    );
    expect(header.length).toBeGreaterThan(0);
    expect(header.every((node: HostNode) => !node.props.hidden)).toBe(true);
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();
  }
});

test("describes waiting requests on the session back button in plain words", async () => {
  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
  mockPendingCount = 2;
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <NavigationContainer ref={navigation}>
      <RootNavigation />
    </NavigationContainer>,
  );
  await screen.findByText("Workspace shell");
  act(() =>
    navigation.navigate("Session", {
      connectionId: "connection-1",
      location: { directory: "/workspace" },
      sessionID: "ses_test",
    }),
  );
  await screen.findByText("Session screen");

  expect(screen.getByRole("button", { name: "Back to Sessions" })).toHaveAccessibilityValue({
    text: "2 requests need you, up to date",
  });
});
