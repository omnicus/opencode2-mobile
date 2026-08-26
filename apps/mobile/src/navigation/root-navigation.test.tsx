import { beforeEach, expect, jest, test } from "@jest/globals";
import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { RootNavigation, type RootStackParamList } from "./root-navigation";

let mockConnections: {
  error?: string;
  profiles: { id: string }[];
  ready: boolean;
};

jest.mock("../connections/connections-context", () => ({
  useConnections: () => mockConnections,
}));
jest.mock("../screens/app-shell", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ConnectionStorageFailureScreen: () => <Text>Connection storage failed</Text>,
    ConnectionStorageLoadingScreen: () => <Text>Connection storage loading</Text>,
    isTabletShell: () => false,
    PendingInteractionsScreen: () => <Text>Pending screen</Text>,
    SettingsScreen: () => <Text>Settings screen</Text>,
  };
});
jest.mock("../screens/followed-projects-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { FollowedProjectsScreen: () => <Text>Followed projects screen</Text> };
});
jest.mock("../screens/new-session-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { NewSessionScreen: () => <Text>New session screen</Text> };
});
jest.mock("./workspace-header-actions", () => ({ WorkspaceHeaderActions: () => null }));
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
    ConnectionScreen: ({ onDone }: { onDone?: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onDone}>
        <Text>Connection manager</Text>
      </Pressable>
    ),
  };
});
jest.mock("../screens/notification-pairing-screen", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { NotificationPairingScreen: () => <Text>Notification pairing</Text> };
});

beforeEach(() => {
  mockConnections = { profiles: [], ready: true };
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

test("opens the configured workspace and returns from connection management", async () => {
  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <NavigationContainer ref={navigation}>
      <RootNavigation />
    </NavigationContainer>,
  );
  expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();

  act(() => navigation.navigate("Connections"));
  expect(await screen.findByText("Connection manager")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Connection manager" }));
  expect(await screen.findByText("Workspace shell")).toBeOnTheScreen();
});

test("pushes session detail and presents workspace management routes over it", async () => {
  mockConnections = { profiles: [{ id: "connection-1" }], ready: true };
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

  act(() => navigation.navigate("NewSession"));
  expect(await screen.findByText("New session screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
  expect(await screen.findByText("Session screen")).toBeOnTheScreen();

  act(() => navigation.navigate("Pending"));
  expect(await screen.findByText("Pending screen")).toBeOnTheScreen();
  act(() => navigation.goBack());
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
