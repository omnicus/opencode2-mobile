import { Component, type ErrorInfo, type ReactNode } from "react";
import { Share, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { applicationName } from "./application-name";
import { Button } from "./components/button";
import { FullScreenState, fullScreenStateStyles } from "./components/full-screen-state";
import { space } from "./theme";
import { AppUpdateCard } from "./updates/app-updates";

type ErrorBoundaryState = { failed: boolean };

export class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately avoid forwarding potentially sensitive render data.
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    // This boundary sits outside the app's SafeAreaProvider, so it needs its own.
    return (
      <SafeAreaProvider>
        <FullScreenState
          copy="The app hit an error and couldn't show this screen. Retry, or share a report. The report doesn't include any server or session content."
          eyebrow="App error"
          title="Something went wrong"
          tone="danger"
        >
          <View style={styles.errorUpdate}>
            <AppUpdateCard />
          </View>
          <View style={fullScreenStateStyles.actions}>
            <Button
              label="Retry"
              onPress={() => this.setState({ failed: false })}
              variant="primary"
            />
            <Button
              label="Share report"
              onPress={() =>
                void Share.share({
                  message: `${applicationName} redacted render diagnostics\nkind=native-render-failure\ncontent_included=false`,
                })
              }
              variant="text"
            />
          </View>
        </FullScreenState>
      </SafeAreaProvider>
    );
  }
}

const styles = StyleSheet.create({
  errorUpdate: { marginTop: space.lg },
});
