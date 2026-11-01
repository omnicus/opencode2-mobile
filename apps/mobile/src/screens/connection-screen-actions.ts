import {
  classifyOpenCodeError,
  createOpenCodeClient,
  probeEventStream,
  probePtyTransport,
} from "@opencode2-mobile/opencode-adapter";
import * as Device from "expo-device";
import { Alert } from "react-native";
import type { ConnectionCredential, ConnectionProfile } from "../connections/connection-profile";
import { boundedOpenCodeFetch, expoOpenCodeFetch } from "../expo-open-code-fetch";
import {
  authorizationOption,
  type ConnectionTarget,
  connectionDiagnostic,
  connectionErrorMessage,
  connectionSaveRequest,
  type Diagnostic,
  emptyConnectionFormValues,
  eventProbeErrorMessage,
  profileErrorMessage,
  profileFormValues,
  ptyProbeErrorMessage,
  resolveConnectionTarget,
} from "./connection-screen-model";
import type { ConnectionScreenState, Connections } from "./connection-screen-state";

export type ConnectionProfileActions = ReturnType<typeof connectionProfileActions>;
export type ConnectionProbeActions = ReturnType<typeof connectionProbeActions>;

function resolveTarget(state: ConnectionScreenState) {
  const target = resolveConnectionTarget(state.values, Device.isDevice);
  if (!("error" in target)) return target;
  state.setError(target.error);
  return undefined;
}

async function checkServer(
  state: ConnectionScreenState,
  target: ConnectionTarget,
): Promise<Diagnostic | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const client = createOpenCodeClient({
      baseUrl: target.origin,
      fetch: boundedOpenCodeFetch,
      ...authorizationOption(target.credential),
    });
    const requestOptions = { signal: controller.signal };
    const [health, sessions] = await Promise.all([
      client.server.status(requestOptions),
      client.session.list({ limit: 1, order: "desc" }, requestOptions),
    ]);
    state.setOrigin(target.origin);
    return connectionDiagnostic(health, sessions.data.length);
  } catch (caught) {
    state.setError(connectionErrorMessage(classifyOpenCodeError(caught)));
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function connectionProfileActions(
  state: ConnectionScreenState,
  connections: Connections,
  onDone?: () => void,
) {
  function populateProfile(profile: ConnectionProfile, credential?: ConnectionCredential) {
    state.loadProfile(profile, profileFormValues(profile, credential));
    state.setShowSecret(false);
    state.resetResults();
  }

  function newConnection() {
    state.profileLoadGeneration.current += 1;
    state.setEditingProfileId(undefined);
    state.setLoadedProfileId("new");
    state.setValues(emptyConnectionFormValues);
    state.setShowSecret(false);
    state.setShowDetails(true);
    state.resetResults();
  }

  async function editProfile(profile: ConnectionProfile) {
    const generation = state.profileLoadGeneration.current + 1;
    state.profileLoadGeneration.current = generation;
    state.clearMessages();
    try {
      const credential = await connections.readCredential(profile);
      if (state.profileLoadGeneration.current !== generation) return;
      populateProfile(profile, credential);
      state.setShowDetails(true);
    } catch {
      if (state.profileLoadGeneration.current === generation) {
        state.setError("This saved connection could not be opened.");
      }
    }
  }

  async function selectProfile(profile: ConnectionProfile) {
    state.clearMessages();
    try {
      await connections.select(profile.id);
      state.setNotice(`${profile.name} selected.`);
      onDone?.();
    } catch {
      state.setError("This saved connection could not be selected.");
    }
  }

  async function saveChecked(target: ConnectionTarget, checked: Diagnostic) {
    state.setSaving(true);
    try {
      const id = await connections.save(
        connectionSaveRequest(state.values, target, checked, state.editingProfileId),
      );
      state.setEditingProfileId(id);
      state.setLoadedProfileId(id);
      state.setNotice("Connected and saved.");
      return true;
    } catch (caught) {
      state.setError(profileErrorMessage(caught));
      return false;
    } finally {
      state.setSaving(false);
    }
  }

  async function connect() {
    if (state.actionsDisabled) return;
    state.resetResults();
    const target = resolveTarget(state);
    if (!target) return;

    state.setBusy(true);
    const checked = await checkServer(state, target);
    state.setBusy(false);
    if (!checked) return;

    if (await saveChecked(target, checked)) onDone?.();
  }

  function confirmRemoval(profile: ConnectionProfile) {
    Alert.alert(
      `Remove ${profile.name}?`,
      `This removes ${new URL(profile.baseUrl).host} and its saved credentials from this device.`,
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => void removeProfile(profile), style: "destructive", text: "Remove" },
      ],
    );
  }

  async function removeProfile(profile: ConnectionProfile) {
    state.clearMessages();
    try {
      await connections.remove(profile.id);
      if (state.editingProfileId === profile.id) newConnection();
      state.setNotice("Connection and credentials removed from this device.");
    } catch {
      state.setError("The connection could not be removed. Try again.");
    }
  }

  return { confirmRemoval, connect, editProfile, newConnection, selectProfile };
}

export function connectionProbeActions(state: ConnectionScreenState) {
  async function testConnection() {
    state.resetResults();
    const target = resolveTarget(state);
    if (!target) return;
    state.setBusy(true);
    try {
      state.setDiagnostic(await checkServer(state, target));
    } finally {
      state.setBusy(false);
    }
  }

  async function testEventStream() {
    state.setError(undefined);
    state.setStreamDiagnostic(undefined);
    const target = resolveTarget(state);
    if (!target) return;

    state.setStreamBusy(true);
    try {
      const client = createOpenCodeClient({
        baseUrl: target.origin,
        fetch: expoOpenCodeFetch,
        ...authorizationOption(target.credential),
      });
      const result = await probeEventStream(client);
      state.setStreamDiagnostic(result);
    } catch (caught) {
      state.setError(eventProbeErrorMessage(caught));
    } finally {
      state.setStreamBusy(false);
    }
  }

  async function testPtyTransport() {
    state.setError(undefined);
    state.setPtyDiagnostic(undefined);
    const target = resolveTarget(state);
    if (!target) return;

    state.setPtyBusy(true);
    try {
      const client = createOpenCodeClient({
        baseUrl: target.origin,
        fetch: boundedOpenCodeFetch,
        ...authorizationOption(target.credential),
      });
      state.setPtyDiagnostic(await probePtyTransport(client, target.origin));
    } catch (caught) {
      state.setError(ptyProbeErrorMessage(caught));
    } finally {
      state.setPtyBusy(false);
    }
  }

  async function testLifecycleRecovery() {
    state.setError(undefined);
    state.lifecycleProbe.reset();
    const target = resolveTarget(state);
    if (!target) return;

    const authorization = authorizationOption(target.credential);
    const streamClient = createOpenCodeClient({
      baseUrl: target.origin,
      fetch: expoOpenCodeFetch,
      ...authorization,
    });
    const restClient = createOpenCodeClient({
      baseUrl: target.origin,
      fetch: boundedOpenCodeFetch,
      ...authorization,
    });
    try {
      await state.lifecycleProbe.run(streamClient, restClient);
    } catch (caught) {
      state.setError(eventProbeErrorMessage(caught));
    }
  }

  return { testConnection, testEventStream, testLifecycleRecovery, testPtyTransport };
}
