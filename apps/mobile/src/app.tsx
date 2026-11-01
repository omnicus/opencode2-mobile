import { NavigationContainer, type Theme } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SQLiteProvider } from "expo-sqlite";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, Share, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { applicationName } from "./application-name";
import { Button } from "./components/button";
import { ConnectionsProvider } from "./connections/connections-context";
import { rootNavigationRef } from "./navigation/navigation-ref";
import { RootNavigation } from "./navigation/root-navigation";
import { NotificationRoutingProvider } from "./notifications/notification-routing-context";
import { AppLockProvider } from "./security/app-lock-context";
import { ConnectionRuntimeProvider } from "./state/connection-runtime-context";
import { FollowedProjectsProvider } from "./state/followed-projects-context";
import { TranscriptPreferencesProvider } from "./state/transcript-preferences";
import { migrateMobileDatabase, mobileDatabaseName } from "./storage/database";
import { palette, space, typeRamp, typography } from "./theme";
import { AppUpdateBanner, AppUpdateCard, AppUpdatesProvider } from "./updates/app-updates";

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      networkMode: "always",
    },
    queries: {
      retry: false,
      staleTime: 15_000,
    },
  },
});

const navigationTheme: Theme = {
  dark: true,
  colors: {
    background: palette.background,
    border: palette.border,
    card: palette.background,
    notification: palette.warm,
    primary: palette.signal,
    text: palette.ink,
  },
  fonts: {
    bold: { fontFamily: "System", fontWeight: "700" },
    heavy: { fontFamily: "System", fontWeight: "800" },
    medium: { fontFamily: "System", fontWeight: "500" },
    regular: { fontFamily: "System", fontWeight: "400" },
  },
};

export default function App() {
  const application = (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={mobileDatabaseName} onInit={migrateMobileDatabase}>
        <AppLockProvider>
          <QueryClientProvider client={queryClient}>
            <ConnectionsProvider>
              <ConnectionRuntimeProvider>
                <FollowedProjectsProvider>
                  <NotificationRoutingProvider>
                    <NavigationContainer ref={rootNavigationRef} theme={navigationTheme}>
                      <View style={styles.appRoot}>
                        <TranscriptPreferencesProvider>
                          <RootNavigation />
                        </TranscriptPreferencesProvider>
                        <AppUpdateBanner />
                      </View>
                    </NavigationContainer>
                  </NotificationRoutingProvider>
                </FollowedProjectsProvider>
              </ConnectionRuntimeProvider>
            </ConnectionsProvider>
          </QueryClientProvider>
        </AppLockProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );

  return (
    <AppUpdatesProvider>
      <RootErrorBoundary>
        <GestureHandlerRootView style={styles.appRoot}>
          {Platform.OS === "android" ? (
            <KeyboardProvider
              navigationBarTranslucent
              preload={false}
              preserveEdgeToEdge
              statusBarTranslucent
            >
              {application}
            </KeyboardProvider>
          ) : (
            application
          )}
        </GestureHandlerRootView>
      </RootErrorBoundary>
    </AppUpdatesProvider>
  );
}

type ErrorBoundaryState = { failed: boolean };

class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately avoid forwarding potentially sensitive render data.
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <View style={styles.errorShell}>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.errorEyebrow}>
          Local failure
        </Text>
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.largeTitle}
          style={styles.errorTitle}
        >
          The native shell stopped rendering.
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.errorCopy}>
          No server or session content was written to diagnostics.
        </Text>
        <AppUpdateCard />
        <View style={styles.errorActions}>
          <Button
            label="Retry"
            onPress={() => this.setState({ failed: false })}
            variant="primary"
          />
          <Button
            label="Share redacted report"
            onPress={() =>
              void Share.share({
                message: `${applicationName} redacted render diagnostics\nkind=native-render-failure\ncontent_included=false`,
              })
            }
            variant="text"
          />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  errorActions: { gap: space.sm, marginTop: space.lg },
  errorCopy: {
    ...typography.subheadline,
    color: palette.dim,
    marginTop: space.sm,
  },
  errorEyebrow: {
    ...typography.sectionLabel,
    color: palette.danger,
  },
  errorShell: {
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
    padding: space.lg,
  },
  errorTitle: {
    ...typography.largeTitle,
    color: palette.ink,
    marginTop: space.sm,
  },
});
