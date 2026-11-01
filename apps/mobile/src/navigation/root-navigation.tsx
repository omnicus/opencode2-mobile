import Feather from "@expo/vector-icons/Feather";
import type { LocationRef } from "@opencode2-mobile/opencode-adapter";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useReducedMotion } from "../components/use-reduced-motion";

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
import { minTouchTarget, palette, pressedOpacity, space, typeRamp, typography } from "../theme";
import { attentionAccessibilityValue } from "./attention-labels";
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
  Pairing: undefined;
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
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const customWorkspaceHeader = usesGlassHeader();

  if (!connections.ready) return <ConnectionStorageLoadingScreen />;
  if (connections.error) return <ConnectionStorageFailureScreen />;
  const pairingOptions = {
    animation: reducedMotion ? "none" : "slide_from_bottom",
    headerShown: false,
    presentation: "modal",
  } as const;
  if (connections.profiles.length === 0) {
    return (
      <Stack.Navigator
        initialRouteName="Connections"
        key="first-run"
        screenOptions={{
          animation: reducedMotion ? "none" : "default",
          contentStyle: { backgroundColor: palette.background },
          headerShown: false,
        }}
      >
        <Stack.Screen name="Connections">
          {({ navigation }) => <ConnectionScreen onPair={() => navigation.navigate("Pairing")} />}
        </Stack.Screen>
        <Stack.Screen name="Pairing" options={pairingOptions}>
          {({ navigation }) => <NotificationPairingScreen onDone={() => navigation.goBack()} />}
        </Stack.Screen>
      </Stack.Navigator>
    );
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
        headerTitleStyle: {
          fontSize: typography.navTitle.fontSize,
          fontWeight: typography.navTitle.fontWeight,
        },
      }}
    >
      <Stack.Screen
        component={WorkspaceScreen}
        name="Workspace"
        // The screen draws its own header with the connection name and search.
        options={{ headerShown: false, title: "Sessions" }}
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
        options={({ navigation }) => ({
          headerShown: true,
          presentation: "modal",
          title: "Needs you",
          headerRight: () => <ManagementDoneButton onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        component={SettingsScreen}
        name="Settings"
        options={({ navigation }) => ({
          headerShown: true,
          presentation: "modal",
          title: "Settings",
          headerRight: () => <ManagementDoneButton onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        component={FollowedProjectsScreen}
        name="FollowedProjects"
        options={({ navigation }) => ({
          headerShown: true,
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
            onPair={() => navigation.navigate("Pairing")}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Pairing" options={pairingOptions}>
        {({ navigation }) => <NotificationPairingScreen onDone={() => navigation.goBack()} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function usesGlassHeader() {
  return Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;
}

function ManagementDoneButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        // iOS 26 wraps header buttons in a glass capsule sized for a standard bar item.
        // A taller view sits off-center inside it, so let the capsule set the size there.
        usesGlassHeader() ? styles.glassDoneButton : styles.doneButton,
        pressed && Platform.OS === "ios" && styles.headerButtonPressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.navTitle} style={styles.doneLabel}>
        Done
      </Text>
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
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.navTitle}
          numberOfLines={1}
          style={styles.headerTitle}
        >
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
        text: attentionAccessibilityValue(selection.pendingCount, selection.attentionCoverage),
      }}
      onPress={onPress}
      style={({ pressed }) => [styles.headerSide, pressed && styles.headerButtonPressed]}
    >
      <Feather
        accessibilityElementsHidden
        color={palette.signal}
        importantForAccessibility="no-hide-descendants"
        name={Platform.OS === "android" ? "arrow-left" : "chevron-left"}
        size={Platform.OS === "android" ? 24 : 28}
      />
      <SessionAttentionMarker />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: 8,
  },
  doneButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: space.sm,
  },
  doneLabel: { ...typography.navTitle, color: palette.signal },
  glassDoneButton: { alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs },
  headerButtonPressed: { opacity: pressedOpacity },
  headerSafeArea: { backgroundColor: palette.background },
  headerSide: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerTitle: {
    ...typography.navTitle,
    color: palette.ink,
    flex: 1,
    textAlign: "center",
  },
});
