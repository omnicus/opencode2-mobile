import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExpoConfig } from "expo/config";

const localDeployment = readLocalDeployment();
const appName = environmentValue("OPENCODE2_MOBILE_APP_NAME") ?? "OpenCode2 Mobile";
const slug = environmentValue("OPENCODE2_MOBILE_APP_SLUG") ?? "opencode2-mobile";
const scheme = environmentValue("OPENCODE2_MOBILE_APP_SCHEME") ?? "opencode2mobile";
const owner = environmentValue("OPENCODE2_MOBILE_EXPO_OWNER");
const projectId = environmentValue("OPENCODE2_MOBILE_EXPO_PROJECT_ID");
const iosBundleIdentifier =
  environmentValue("OPENCODE2_MOBILE_IOS_BUNDLE_IDENTIFIER") ?? "dev.opencode2.mobile";
const androidPackage =
  environmentValue("OPENCODE2_MOBILE_ANDROID_PACKAGE") ?? "dev.opencode2.mobile";
const googleServicesFile = environmentValue("GOOGLE_SERVICES_JSON");
const allowDevelopmentHttp = booleanEnvironmentValue(
  "OPENCODE2_MOBILE_ALLOW_DEVELOPMENT_HTTP",
  false,
);

assertMatch("OPENCODE2_MOBILE_APP_SLUG", slug, /^[a-z0-9][a-z0-9_-]*$/);
assertMatch("OPENCODE2_MOBILE_APP_SCHEME", scheme, /^[a-z][a-z0-9+.-]*$/);
assertMatch(
  "OPENCODE2_MOBILE_IOS_BUNDLE_IDENTIFIER",
  iosBundleIdentifier,
  /^(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+$/,
);
assertMatch(
  "OPENCODE2_MOBILE_ANDROID_PACKAGE",
  androidPackage,
  /^(?:[A-Za-z][A-Za-z0-9_]*\.)+[A-Za-z][A-Za-z0-9_]*$/,
);
if (projectId) {
  assertMatch(
    "OPENCODE2_MOBILE_EXPO_PROJECT_ID",
    projectId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}

const config: ExpoConfig = {
  name: appName,
  slug,
  version: "0.1.4",
  newArchEnabled: true,
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  orientation: "default",
  userInterfaceStyle: "automatic",
  backgroundColor: "#0B0D0C",
  scheme,
  updates: projectId
    ? { enabled: true, url: `https://u.expo.dev/${projectId}` }
    : { enabled: false },
  ios: {
    bundleIdentifier: iosBundleIdentifier,
    buildNumber: "7",
    supportsTablet: true,
    config: {
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      NSUserNotificationUsageDescription: `${appName} notifies you when OpenCode needs a permission or form response, or finishes a session.`,
      NSLocalNetworkUsageDescription: `${appName} connects to development servers that you approve on your private network.`,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: allowDevelopmentHttp,
      },
    },
  },
  android: {
    package: androidPackage,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    versionCode: 6,
    allowBackup: false,
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: "#151314",
    },
  },
  plugins: [
    "expo-dev-client",
    [
      "expo-secure-store",
      {
        configureAndroidBackup: true,
      },
    ],
    [
      "expo-local-authentication",
      {
        faceIDPermission: `Allow ${appName} to authenticate before showing saved connections.`,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          usesCleartextTraffic: allowDevelopmentHttp,
        },
        ios: {
          deploymentTarget: "15.1",
        },
      },
    ],
    "./plugins/with-ios-database-backup-exclusion",
    [
      "expo-camera",
      {
        cameraPermission: `Allow ${appName} to scan a pairing QR code shown by your OpenCode server.`,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-notifications",
      {
        defaultChannel: "opencode-attention",
      },
    ],
    "expo-sqlite",
  ],
  ...(owner ? { owner } : {}),
  ...(projectId ? { extra: { eas: { projectId } } } : {}),
  runtimeVersion: {
    policy: "appVersion",
  },
};

export default config;

function environmentValue(name: string) {
  const value = (process.env[name] ?? localDeployment[name])?.trim();
  return value ? value : undefined;
}

function assertMatch(name: string, value: string, pattern: RegExp) {
  if (!pattern.test(value)) throw new Error(`${name} is invalid`);
}

function booleanEnvironmentValue(name: string, fallback: boolean) {
  const value = environmentValue(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readLocalDeployment() {
  if (process.env.OPENCODE2_MOBILE_DISABLE_LOCAL_DEPLOYMENT === "1") return {};
  const path = resolve(__dirname, "config/local/deployment.json");
  if (!existsSync(path)) return {};
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error("config/local/deployment.json must be an object");
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`config/local/deployment.json field ${name} must be a string`);
    }
  }
  return value as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
