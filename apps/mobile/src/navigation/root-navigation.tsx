import Feather from "@expo/vector-icons/Feather";
import type { LocationRef } from "@opencode2-mobile/opencode-adapter";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnections } from "../connections/connections-context";
import {
  ConnectionStorageFailureScreen,
  ConnectionStorageLoadingScreen,
  isTabletShell,
  PendingInteractionsScreen,
  SettingsScreen,
} from "../screens/app-shell";
import { ConnectionScreen } from "../screens/connection-screen";
import { DiffScreen } from "../screens/diff-screen";
import { FollowedProjectsScreen } from "../screens/followed-projects-screen";
import { NewSessionScreen } from "../screens/new-session-screen";
import { NotificationPairingScreen } from "../screens/notification-pairing-screen";
import { SessionScreen, WorkspaceScreen } from "../screens/workspace-screen";
import { palette } from "../theme";
import { WorkspaceHeaderActions } from "./workspace-header-actions";

export type RootStackParamList = {
  Connections: undefined;
  Diff: {
    connectionId: string;
    location: LocationRef;
    mode: "branch" | "working";
  };
  FollowedProjects: undefined;
  NewSession: undefined;
  Pending: undefined;
  Session: {
    connectionId: string;
    focusComposer?: boolean;
    location: LocationRef;
    sessionID: string;
  };
  Settings: undefined;
  Workspace: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigation() {
  const connections = useConnections();
  const [showPairing, setShowPairing] = useState(false);
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const customWorkspaceHeader =
    Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

  if (showPairing) {
    return <NotificationPairingScreen onDone={() => setShowPairing(false)} />;
  }

  if (!connections.ready) return <ConnectionStorageLoadingScreen />;
  if (connections.error) return <ConnectionStorageFailureScreen />;
  if (connections.profiles.length === 0) {
    return <ConnectionScreen onPair={() => setShowPairing(true)} />;
  }
  const selected = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );

  return (
    <Stack.Navigator
      initialRouteName="Workspace"
      key={`${selected?.id ?? "unselected"}:${selected?.updatedAtMs ?? 0}`}
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: palette.background },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerShown: !tablet,
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.ink,
      }}
    >
      <Stack.Screen
        component={WorkspaceScreen}
        name="Workspace"
        options={({ navigation }) => ({
          ...(customWorkspaceHeader
            ? {
                header: () => (
                  <WorkspaceHeader
                    navigate={(destination) => navigation.navigate(destination)}
                    title="Sessions"
                  />
                ),
              }
            : {
                headerRight: () => (
                  <WorkspaceHeaderActions
                    navigate={(destination) => navigation.navigate(destination)}
                  />
                ),
              }),
          title: "Sessions",
        })}
      />
      <Stack.Screen
        component={SessionScreen}
        name="Session"
        options={({ navigation }) => ({
          ...(customWorkspaceHeader
            ? {
                header: () => (
                  <WorkspaceHeader
                    navigate={(destination) => navigation.navigate(destination)}
                    onBack={() => {
                      if (navigation.canGoBack()) navigation.goBack();
                      else navigation.popTo("Workspace");
                    }}
                    title="Session"
                  />
                ),
              }
            : {
                ...(!navigation.canGoBack()
                  ? {
                      headerLeft: () => (
                        <Pressable
                          accessibilityLabel="Back to Sessions"
                          accessibilityRole="button"
                          onPress={() => navigation.popTo("Workspace")}
                          style={{ justifyContent: "center", minHeight: 44, paddingRight: 12 }}
                        >
                          <Text style={{ color: palette.signal, fontSize: 16, fontWeight: "700" }}>
                            Sessions
                          </Text>
                        </Pressable>
                      ),
                    }
                  : {}),
                headerRight: () => (
                  <WorkspaceHeaderActions
                    navigate={(destination) => navigation.navigate(destination)}
                  />
                ),
              }),
          title: "Session",
        })}
      />
      <Stack.Screen
        component={DiffScreen}
        name="Diff"
        options={{ headerShown: true, title: "Current changes" }}
      />
      <Stack.Screen
        component={NewSessionScreen}
        name="NewSession"
        options={{ headerShown: false, presentation: "modal", title: "New session" }}
      />
      <Stack.Screen
        component={PendingInteractionsScreen}
        name="Pending"
        options={{ presentation: "modal", title: "Needs you" }}
      />
      <Stack.Screen
        component={SettingsScreen}
        name="Settings"
        options={{ presentation: "modal", title: "Settings" }}
      />
      <Stack.Screen
        component={FollowedProjectsScreen}
        name="FollowedProjects"
        options={{ presentation: "modal", title: "Followed projects" }}
      />
      <Stack.Screen
        name="Connections"
        options={{
          animation: reducedMotion ? "none" : "slide_from_bottom",
          headerShown: false,
          presentation: "modal",
        }}
      >
        {({ navigation }) => (
          <ConnectionScreen
            onDone={() => navigation.goBack()}
            onPair={() => setShowPairing(true)}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function WorkspaceHeader({
  navigate,
  onBack,
  title,
}: {
  navigate: (destination: "Connections" | "FollowedProjects" | "Pending" | "Settings") => void;
  onBack?: () => void;
  title: string;
}) {
  return (
    <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable
            accessibilityLabel="Back to Sessions"
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.headerSide, pressed && styles.headerButtonPressed]}
          >
            <Feather
              accessibilityElementsHidden
              color={palette.signal}
              importantForAccessibility="no-hide-descendants"
              name="chevron-left"
              size={28}
            />
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
        <WorkspaceHeaderActions navigate={navigate} />
      </View>
    </SafeAreaView>
  );
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    height: 44,
    paddingHorizontal: 8,
  },
  headerButtonPressed: { opacity: 0.55 },
  headerSafeArea: { backgroundColor: palette.background },
  headerSide: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerTitle: {
    color: palette.ink,
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
});
