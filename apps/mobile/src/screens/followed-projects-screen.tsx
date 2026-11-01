import Feather from "@expo/vector-icons/Feather";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Button } from "../components/button";
import { managementStyles } from "../components/management-layout";
import { useAnnouncement } from "../components/use-announcement";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { cardSurface, palette, pressedOpacity, space, typeRamp, typography } from "../theme";
import { isTabletShell, navigateToSection, ShellFrame } from "./app-shell";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "FollowedProjects">;

const saveError = "The followed project selection could not be saved. Try again.";

export function FollowedProjectsScreen({ navigation }: Props) {
  const selection = useWorkspaceSelection();
  const { width } = useWindowDimensions();
  const [error, setError] = useState(false);
  // Fixed on first render with projects so a tapped row stays under the finger and screen
  // reader focus. Earlier and Later reorder followed rows explicitly.
  const [initialOrder, setInitialOrder] = useState<string[]>();
  const followed = new Set(selection.followedProjectIds);
  if (!initialOrder && selection.projects.length > 0 && !selection.preferencesLoading) {
    setInitialOrder(sortProjectIDs(selection.projects, selection.followedProjectIds));
  }
  const projects = orderProjects(
    selection.projects,
    selection.followedProjectIds,
    initialOrder ?? [],
  );
  useAnnouncement(error && saveError);

  async function save(projectIDs: string[]) {
    setError(false);
    try {
      await selection.setFollowedProjectIds(projectIDs);
    } catch {
      setError(true);
    }
  }

  function toggle(projectID: string) {
    const next = followed.has(projectID)
      ? selection.followedProjectIds.filter((candidate) => candidate !== projectID)
      : [...selection.followedProjectIds, projectID];
    void save(next);
  }

  function move(projectID: string, offset: -1 | 1) {
    const currentIndex = selection.followedProjectIds.indexOf(projectID);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selection.followedProjectIds.length)
      return;
    const next = [...selection.followedProjectIds];
    const currentProjectID = next[currentIndex];
    const nextProjectID = next[nextIndex];
    if (!currentProjectID || !nextProjectID) return;
    next[currentIndex] = nextProjectID;
    next[nextIndex] = currentProjectID;
    void save(next);
  }

  return (
    <ShellFrame
      active="Settings"
      hideConnectionBar={!isTabletShell(width)}
      navigate={(section) => navigateToSection(navigation, section)}
    >
      <ScrollView contentContainerStyle={managementStyles.content}>
        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.subheadline}
            style={styles.error}
          >
            {saveError}
          </Text>
        ) : null}
        <View style={styles.intro}>
          <Text dynamicTypeRamp={typeRamp.footnote} style={[styles.copy, styles.introCopy]}>
            Choose the projects shown in Sessions and Needs you. Following is saved on this device
            only and does not change projects on the server.
          </Text>
          {selection.preferencesSaving ? (
            <ActivityIndicator accessibilityLabel="Saving" color={palette.signal} />
          ) : null}
        </View>
        {selection.preferencesLoading || selection.projectsLoading ? (
          <View style={styles.state}>
            <ActivityIndicator accessibilityLabel="Loading projects" color={palette.signal} />
            <Text dynamicTypeRamp={typeRamp.footnote} style={styles.copy}>
              Loading projects
            </Text>
          </View>
        ) : selection.projectsError ? (
          <View style={styles.state}>
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.subheadline}
              style={styles.error}
            >
              Projects could not be loaded from this connection. Try again.
            </Text>
            <Button
              accessibilityLabel="Retry loading projects"
              label="Retry"
              onPress={() => void selection.refetch()}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {projects.length === 0 && selection.unavailableProjectIds.length === 0 ? (
              <View style={styles.state}>
                <Text dynamicTypeRamp={typeRamp.headline} style={styles.projectTitle}>
                  No server projects found
                </Text>
                <Text dynamicTypeRamp={typeRamp.footnote} style={styles.copy}>
                  Open a project in OpenCode, then refresh this list.
                </Text>
                <Button
                  accessibilityLabel="Refresh projects"
                  label="Refresh"
                  onPress={() => void selection.refetch()}
                />
              </View>
            ) : null}
            {projects.map((project) => {
              const selected = followed.has(project.id);
              const position = selection.followedProjectIds.indexOf(project.id);
              const path = sanitizeTranscriptText(project.canonical, 1_024);
              return (
                <View key={project.id} style={[styles.project, selected && styles.projectSelected]}>
                  <Pressable
                    accessibilityLabel={projectLabel(project)}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      busy: selection.preferencesSaving,
                      checked: selected,
                      disabled: selection.preferencesSaving,
                    }}
                    android_ripple={
                      Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined
                    }
                    disabled={selection.preferencesSaving}
                    onPress={() => toggle(project.id)}
                    style={({ pressed }) => [
                      styles.projectMain,
                      pressed && Platform.OS === "ios" && styles.pressed,
                    ]}
                  >
                    <Feather
                      accessibilityElementsHidden
                      color={selected ? palette.signal : palette.dim}
                      importantForAccessibility="no-hide-descendants"
                      name={selected ? "check-square" : "square"}
                      size={22}
                      style={styles.checkbox}
                    />
                    <View style={styles.projectText}>
                      <Text dynamicTypeRamp={typeRamp.headline} style={styles.projectTitle}>
                        {projectLabel(project)}
                      </Text>
                      <Text
                        dynamicTypeRamp={typeRamp.footnote}
                        numberOfLines={2}
                        selectable
                        style={styles.projectPath}
                      >
                        {path}
                      </Text>
                    </View>
                  </Pressable>
                  {selected ? (
                    <View style={styles.orderActions}>
                      <Button
                        accessibilityLabel={`Move ${projectLabel(project)} earlier`}
                        disabled={selection.preferencesSaving || position <= 0}
                        label="Earlier"
                        onPress={() => move(project.id, -1)}
                        size="compact"
                      />
                      <Button
                        accessibilityLabel={`Move ${projectLabel(project)} later`}
                        disabled={
                          selection.preferencesSaving ||
                          position === selection.followedProjectIds.length - 1
                        }
                        label="Later"
                        onPress={() => move(project.id, 1)}
                        size="compact"
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
            {selection.unavailableProjectIds.map((projectID) => (
              <View key={projectID} style={styles.unavailableProject}>
                <Text dynamicTypeRamp={typeRamp.headline} style={styles.projectTitle}>
                  Unavailable project
                </Text>
                <Text dynamicTypeRamp={typeRamp.footnote} style={styles.copy}>
                  This followed project is no longer in the server project list.
                </Text>
                <Button
                  accessibilityLabel="Unfollow unavailable project"
                  disabled={selection.preferencesSaving}
                  label="Unfollow"
                  onPress={() => toggle(projectID)}
                  size="compact"
                  variant="danger"
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ShellFrame>
  );
}

type ListedProject = ReturnType<typeof useWorkspaceSelection>["projects"][number];

function sortProjectIDs(projects: ListedProject[], followedProjectIDs: string[]) {
  const projectOrder = new Map(followedProjectIDs.map((projectID, index) => [projectID, index]));
  return projects
    .map((project, serverIndex) => ({ project, serverIndex }))
    .sort((first, second) => {
      const firstPosition = projectOrder.get(first.project.id);
      const secondPosition = projectOrder.get(second.project.id);
      if (firstPosition !== undefined && secondPosition !== undefined) {
        return firstPosition - secondPosition;
      }
      if (firstPosition !== undefined) return -1;
      if (secondPosition !== undefined) return 1;
      return first.serverIndex - second.serverIndex;
    })
    .map(({ project }) => project.id);
}

// Rows keep the slots they had when the screen opened. Followed rows fill the followed slots in
// the saved order, so Earlier and Later still move them; new server projects go last.
function orderProjects(projects: ListedProject[], followedProjectIDs: string[], initial: string[]) {
  const byID = new Map(projects.map((project) => [project.id, project]));
  const followed = new Set(followedProjectIDs);
  const slots = initial.filter((projectID) => byID.has(projectID));
  const followedInSlots = followedProjectIDs.filter(
    (projectID) => byID.has(projectID) && slots.includes(projectID),
  );
  let nextFollowed = 0;
  const ordered = slots.map((projectID) =>
    followed.has(projectID) ? (followedInSlots[nextFollowed++] ?? projectID) : projectID,
  );
  const placed = new Set(ordered);
  return [
    ...ordered,
    ...projects.map((project) => project.id).filter((projectID) => !placed.has(projectID)),
  ].flatMap((projectID) => byID.get(projectID) ?? []);
}

function projectLabel(project: { canonical: string; id: string; name?: string }) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

const styles = StyleSheet.create({
  copy: { ...typography.footnote, color: palette.dim },
  error: { ...typography.subheadline, color: palette.danger },
  checkbox: { marginTop: 1 },
  intro: { alignItems: "center", flexDirection: "row", gap: space.sm },
  introCopy: { flex: 1 },
  list: { gap: space.sm },
  orderActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  pressed: { opacity: pressedOpacity },
  project: { ...cardSurface, overflow: "hidden", padding: 0 },
  projectMain: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.sm,
    minHeight: 72,
    padding: space.md,
  },
  projectPath: { ...typography.footnote, color: palette.dim },
  projectSelected: { borderColor: palette.signal },
  projectText: { flex: 1, gap: 4, minWidth: 0 },
  projectTitle: { ...typography.headline, color: palette.ink },
  state: { gap: space.sm, paddingVertical: space.xl },
  unavailableProject: { ...cardSurface, borderColor: palette.warm, gap: space.sm },
});
