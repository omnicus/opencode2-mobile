import Feather from "@expo/vector-icons/Feather";
import type { LocationRef } from "@opencode2-mobile/opencode-adapter";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { type ReactNode, useEffect, useState } from "react";
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
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette } from "../theme";
import { SessionAttentionMarker } from "./workspace-header-actions";

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
        headerTitleStyle: { fontSize: 16, fontWeight: "500" },
      }}
    >
      <Stack.Screen
        component={WorkspaceScreen}
        name="Workspace"
        options={() => ({
          ...(customWorkspaceHeader
            ? {
                header: () => <WorkspaceHeader title="Sessions" />,
              }
            : {}),
          title: "Sessions",
        })}
      />
      <Stack.Screen
        component={SessionScreen}
        name="Session"
        options={({ navigation }) => ({
          ...(customWorkspaceHeader
            ? {
                header: ({ options }) => (
                  <WorkspaceHeader
                    rightActions={options.headerRight?.({
                      canGoBack: navigation.canGoBack(),
                      tintColor: palette.ink,
                    })}
                    onBack={() => {
                      if (navigation.canGoBack()) navigation.goBack();
                      else navigation.popTo("Workspace");
                    }}
                    title={options.title ?? "Session"}
                  />
                ),
              }
            : {
                headerLeft: () => (
                  <SessionBackButton
                    onPress={() => {
                      if (navigation.canGoBack()) navigation.goBack();
                      else navigation.popTo("Workspace");
                    }}
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
        options={({ navigation }) => ({
          presentation: "modal",
          title: "Settings",
          headerRight: () => <ManagementDoneButton onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        component={FollowedProjectsScreen}
        name="FollowedProjects"
        options={({ navigation }) => ({
          presentation: "modal",
          title: "Followed projects",
          headerRight: () => <ManagementDoneButton onPress={() => navigation.goBack()} />,
        })}
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

function ManagementDoneButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10 }}
    >
      <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "600" }}>Done</Text>
    </Pressable>
  );
}

function WorkspaceHeader({
  onBack,
  title,
  rightActions,
}: {
  onBack?: () => void;
  title: string;
  rightActions?: ReactNode;
}) {
  return (
    <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
      <View style={styles.header}>
        {onBack ? <SessionBackButton onPress={onBack} /> : <View style={styles.headerSide} />}
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
        {rightActions ?? <View style={styles.headerSide} />}
      </View>
    </SafeAreaView>
  );
}

function SessionBackButton({ onPress }: { onPress: () => void }) {
  const selection = useWorkspaceSelection();
  return (
    <Pressable
      accessibilityLabel="Back to Sessions"
      accessibilityRole="button"
      accessibilityHint={
        selection.pendingCount > 0
          ? "The session list has requests needing attention"
          : "Returns to the session list"
      }
      accessibilityValue={{
        text: `${selection.pendingCount} known requests, ${selection.attentionCoverage.freshness}`,
      }}
      onPress={onPress}
      style={({ pressed }) => [styles.headerSide, pressed && styles.headerButtonPressed]}
    >
      <Feather
        accessibilityElementsHidden
        color={palette.signal}
        importantForAccessibility="no-hide-descendants"
        name="chevron-left"
        size={28}
      />
      <SessionAttentionMarker />
    </Pressable>
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
    minHeight: 44,
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
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
});
