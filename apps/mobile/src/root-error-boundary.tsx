import { Component, type ErrorInfo, type ReactNode } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { applicationName } from "./application-name";
import { Button } from "./components/button";
import { palette, space, typeRamp, typography } from "./theme";
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
        <SafeAreaView style={styles.errorShell}>
          <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.errorEyebrow}>
            App error
          </Text>
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.largeTitle}
            style={styles.errorTitle}
          >
            Something went wrong.
          </Text>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.errorCopy}>
            The app hit an error and couldn't show this screen. Try again, or share a report. The
            report doesn't include any server or session content.
          </Text>
          <View style={styles.errorUpdate}>
            <AppUpdateCard />
          </View>
          <View style={styles.errorActions}>
            <Button
              label="Try again"
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
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
}

const styles = StyleSheet.create({
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
  errorUpdate: { marginTop: space.lg },
  errorTitle: {
    ...typography.largeTitle,
    color: palette.ink,
    marginTop: space.sm,
  },
});
