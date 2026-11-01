import { Appearance } from "react-native";

// The app has one dark theme, but native chrome such as iOS 26 header glass and alerts
// follows the system appearance unless the app overrides it. app.config.ts still says
// "automatic" because changing it alters the native fingerprint used by EAS Update.
export function pinDarkAppearance() {
  Appearance.setColorScheme("dark");
}
