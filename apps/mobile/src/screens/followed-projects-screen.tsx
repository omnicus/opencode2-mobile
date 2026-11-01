import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../components/button";
import { managementStyles } from "../components/management-layout";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { cardSurface, palette, pressedOpacity, space, typeRamp, typography } from "../theme";
import { ShellFrame } from "./app-shell";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "FollowedProjects">;

export function FollowedProjectsScreen({ navigation }: Props) {
  const selection = useWorkspaceSelection();
  const [error, setError] = useState(false);
  const followed = new Set(selection.followedProjectIds);
  const projectOrder = new Map(
    selection.followedProjectIds.map((projectID, index) => [projectID, index]),
  );
  const projects = selection.projects
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
    .map(({ project }) => project);

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
      navigate={(section) =>
        section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section)
      }
    >
      <ScrollView contentContainerStyle={managementStyles.content}>
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.copy}>
          Choose the projects in your session inbox. Following is saved on this device only and does
          not change server projects.
        </Text>
        {selection.preferencesLoading || selection.projectsLoading ? (
          <View style={styles.state}>
            <ActivityIndicator accessibilityLabel="Loading projects" color={palette.signal} />
            <Text dynamicTypeRamp={typeRamp.footnote} style={styles.copy}>
              Loading known projects
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
                    accessibilityLabel={`${projectLabel(project)}, ${selected ? "Following" : "Not followed"}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{
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
                    <Text
                      dynamicTypeRamp={typeRamp.sectionLabel}
                      style={[styles.followState, selected && styles.followStateSelected]}
                    >
                      {selected ? "✓ Following" : "Not followed"}
                    </Text>
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
        {error ? (
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.subheadline}
            style={styles.error}
          >
            The followed project selection could not be saved.
          </Text>
        ) : null}
      </ScrollView>
    </ShellFrame>
  );
}

function projectLabel(project: { canonical: string; id: string; name?: string }) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

const styles = StyleSheet.create({
  copy: { ...typography.footnote, color: palette.dim },
  error: { ...typography.subheadline, color: palette.danger },
  followState: { ...typography.sectionLabel, color: palette.dim },
  followStateSelected: { color: palette.signal },
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
  projectMain: { gap: 4, minHeight: 72, padding: space.md },
  projectPath: { ...typography.footnote, color: palette.dim },
  projectSelected: { borderColor: palette.border },
  projectTitle: { ...typography.headline, color: palette.ink },
  state: { gap: space.sm, paddingVertical: space.xl },
  unavailableProject: { ...cardSurface, borderColor: palette.warm, gap: space.sm },
});
