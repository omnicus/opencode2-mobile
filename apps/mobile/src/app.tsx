import { NavigationContainer, type Theme } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SQLiteProvider } from "expo-sqlite";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { applicationName } from "./application-name";
import { ConnectionsProvider } from "./connections/connections-context";
import { rootNavigationRef } from "./navigation/navigation-ref";
import { RootNavigation } from "./navigation/root-navigation";
import { NotificationRoutingProvider } from "./notifications/notification-routing-context";
import { AppLockProvider } from "./security/app-lock-context";
import { ConnectionRuntimeProvider } from "./state/connection-runtime-context";
import { FollowedProjectsProvider } from "./state/followed-projects-context";
import { migrateMobileDatabase, mobileDatabaseName } from "./storage/database";
import { palette } from "./theme";

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
  return (
    <RootErrorBoundary>
      <GestureHandlerRootView style={styles.appRoot}>
        <SafeAreaProvider>
          <SQLiteProvider databaseName={mobileDatabaseName} onInit={migrateMobileDatabase}>
            <AppLockProvider>
              <QueryClientProvider client={queryClient}>
                <ConnectionsProvider>
                  <ConnectionRuntimeProvider>
                    <FollowedProjectsProvider>
                      <NotificationRoutingProvider>
                        <NavigationContainer ref={rootNavigationRef} theme={navigationTheme}>
                          <RootNavigation />
                        </NavigationContainer>
                      </NotificationRoutingProvider>
                    </FollowedProjectsProvider>
                  </ConnectionRuntimeProvider>
                </ConnectionsProvider>
              </QueryClientProvider>
            </AppLockProvider>
          </SQLiteProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RootErrorBoundary>
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
        <Text style={styles.errorEyebrow}>LOCAL FAILURE</Text>
        <Text accessibilityRole="header" style={styles.errorTitle}>
          The native shell stopped rendering.
        </Text>
        <Text style={styles.errorCopy}>
          No server or session content was written to diagnostics.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ failed: false })}
          style={styles.retryButton}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void Share.share({
              message: `${applicationName} redacted render diagnostics\nkind=native-render-failure\ncontent_included=false`,
            })
          }
          style={styles.reportButton}
        >
          <Text style={styles.reportLabel}>Share redacted report</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  errorCopy: {
    color: palette.dim,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  errorEyebrow: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  errorShell: {
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  errorTitle: {
    color: palette.ink,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.8,
    lineHeight: 35,
    marginTop: 10,
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: palette.signal,
    borderRadius: 8,
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  retryLabel: {
    color: palette.background,
    fontSize: 15,
    fontWeight: "800",
  },
  reportButton: {
    marginTop: 18,
    minHeight: 44,
    paddingVertical: 12,
  },
  reportLabel: {
    color: palette.dim,
    fontSize: 14,
    fontWeight: "700",
  },
});
