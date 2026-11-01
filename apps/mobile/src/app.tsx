import { NavigationContainer, type Theme } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SQLiteProvider } from "expo-sqlite";
import { Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { pinDarkAppearance } from "./appearance";
import { ConnectionsProvider } from "./connections/connections-context";
import { rootNavigationRef } from "./navigation/navigation-ref";
import { RootNavigation } from "./navigation/root-navigation";
import { NotificationRoutingProvider } from "./notifications/notification-routing-context";
import { RootErrorBoundary } from "./root-error-boundary";
import { AppLockProvider } from "./security/app-lock-context";
import { ConnectionRuntimeProvider } from "./state/connection-runtime-context";
import { FollowedProjectsProvider } from "./state/followed-projects-context";
import { TranscriptPreferencesProvider } from "./state/transcript-preferences";
import { migrateMobileDatabase, mobileDatabaseName } from "./storage/database";
import { palette } from "./theme";
import { AppUpdateBanner, AppUpdatesProvider } from "./updates/app-updates";

pinDarkAppearance();

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

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
});
