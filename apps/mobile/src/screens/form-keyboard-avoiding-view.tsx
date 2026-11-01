import type { ReactNode } from "react";
import {
  KeyboardAvoidingView as NativeKeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

// KeyboardProvider is mounted on Android only (app.tsx), and the library view does nothing
// without it, so iOS keeps React Native's view with the same behavior.
export function FormKeyboardAvoidingView({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  if (Platform.OS === "android") {
    return (
      <KeyboardAvoidingView behavior="padding" style={style}>
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <NativeKeyboardAvoidingView behavior="padding" style={style}>
      {children}
    </NativeKeyboardAvoidingView>
  );
}
