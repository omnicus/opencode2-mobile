import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { RootStackParamList } from "../navigation/root-navigation";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette, radius, space, typeRamp } from "../theme";
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
      <ScrollView contentContainerStyle={styles.content}>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.eyebrow}>
          FOLLOWED PROJECTS
        </Text>
        <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.heading} style={styles.title}>
          Choose the projects in your session inbox.
        </Text>
        <Text dynamicTypeRamp={typeRamp.body} style={styles.copy}>
          Following is stored on this device. It does not create, modify, or remove server projects.
        </Text>
        {selection.preferencesLoading || selection.projectsLoading ? (
          <View style={styles.state}>
            <ActivityIndicator accessibilityLabel="Loading projects" color={palette.signal} />
            <Text style={styles.copy}>Loading known projects</Text>
          </View>
        ) : selection.projectsError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Projects could not be loaded from this connection.
          </Text>
        ) : (
          <View style={styles.list}>
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
                    disabled={selection.preferencesSaving}
                    onPress={() => toggle(project.id)}
                    style={({ pressed }) => [styles.projectMain, pressed && styles.pressed]}
                  >
                    <Text style={styles.projectTitle}>{projectLabel(project)}</Text>
                    <Text numberOfLines={2} selectable style={styles.projectPath}>
                      {path}
                    </Text>
                    <Text style={[styles.followState, selected && styles.followStateSelected]}>
                      {selected ? "FOLLOWING" : "NOT FOLLOWED"}
                    </Text>
                  </Pressable>
                  {selected ? (
                    <View style={styles.orderActions}>
                      <OrderButton
                        disabled={selection.preferencesSaving || position <= 0}
                        label={`Move ${projectLabel(project)} earlier`}
                        onPress={() => move(project.id, -1)}
                        text="Earlier"
                      />
                      <OrderButton
                        disabled={
                          selection.preferencesSaving ||
                          position === selection.followedProjectIds.length - 1
                        }
                        label={`Move ${projectLabel(project)} later`}
                        onPress={() => move(project.id, 1)}
                        text="Later"
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
            {selection.unavailableProjectIds.map((projectID) => (
              <View key={projectID} style={styles.unavailableProject}>
                <Text style={styles.projectTitle}>Unavailable project</Text>
                <Text style={styles.copy}>
                  This followed project is no longer in the server project list.
                </Text>
                <Pressable
                  accessibilityLabel="Unfollow unavailable project"
                  accessibilityRole="button"
                  disabled={selection.preferencesSaving}
                  onPress={() => toggle(projectID)}
                  style={({ pressed }) => [styles.unfollowButton, pressed && styles.pressed]}
                >
                  <Text style={styles.unfollowLabel}>Unfollow</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            The followed project selection could not be saved.
          </Text>
        ) : null}
      </ScrollView>
    </ShellFrame>
  );
}

function OrderButton({
  disabled,
  label,
  onPress,
  text,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.orderButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.orderLabel}>{text}</Text>
    </Pressable>
  );
}

function projectLabel(project: { canonical: string; id: string; name?: string }) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xl },
  copy: { color: palette.dim, fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.35 },
  error: { color: palette.danger, fontSize: 14, lineHeight: 20 },
  eyebrow: { color: palette.signal, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  followState: { color: palette.dim, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  followStateSelected: { color: palette.signal },
  list: { gap: space.sm },
  orderActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, padding: space.sm },
  orderButton: {
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space.md,
  },
  orderLabel: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.58 },
  project: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  projectMain: { gap: space.xs, minHeight: 72, padding: space.md },
  projectPath: { color: palette.dim, fontSize: 12, lineHeight: 17 },
  projectSelected: { borderColor: palette.signal },
  projectTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  state: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  title: { color: palette.ink, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  unavailableProject: {
    backgroundColor: palette.card,
    borderColor: palette.warm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.sm,
    padding: space.md,
  },
  unfollowButton: {
    alignItems: "center",
    borderColor: palette.danger,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  unfollowLabel: { color: palette.danger, fontSize: 13, fontWeight: "800" },
});
