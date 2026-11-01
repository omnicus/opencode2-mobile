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
import { ProjectAvatar } from "../components/project-avatar";
import { useAnnouncement } from "../components/use-announcement";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { cardSurface, palette, pressedOpacity, space, typeRamp, typography } from "../theme";
import { isTabletShell, navigateToSection, ShellFrame } from "./app-shell";
import {
  moveFollowedProject,
  orderProjects,
  projectLabel,
  sortProjectIDs,
  toggleFollowedProject,
} from "./followed-projects-screen-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "FollowedProjects">;

const saveError = "The followed project selection could not be saved. Try again.";

export function FollowedProjectsScreen({ navigation }: Props) {
  const selection = useWorkspaceSelection();
  const { fontScale, width } = useWindowDimensions();
  const [error, setError] = useState(false);
  // Fixed on first render with projects so a tapped row stays under the finger and screen
  // reader focus. Earlier and Later reorder followed rows explicitly.
  const [initialOrder, setInitialOrder] = useState<string[]>();
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
    void save(toggleFollowedProject(selection.followedProjectIds, projectID));
  }

  function move(projectID: string, offset: -1 | 1) {
    const next = moveFollowedProject(selection.followedProjectIds, projectID, offset);
    if (next) void save(next);
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
            {projects.map((project) => (
              <FollowedProjectRow
                key={project.id}
                followedProjectIds={selection.followedProjectIds}
                fontScale={fontScale}
                onMove={move}
                onToggle={toggle}
                project={project}
                saving={selection.preferencesSaving}
              />
            ))}
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

function FollowedProjectRow({
  followedProjectIds,
  fontScale,
  onMove,
  onToggle,
  project,
  saving,
}: {
  followedProjectIds: readonly string[];
  fontScale: number;
  onMove: (projectID: string, offset: -1 | 1) => void;
  onToggle: (projectID: string) => void;
  project: ReturnType<typeof useWorkspaceSelection>["projects"][number];
  saving: boolean;
}) {
  const position = followedProjectIds.indexOf(project.id);
  const selected = position >= 0;
  const path = sanitizeTranscriptText(project.canonical, 1_024);
  return (
    <View style={[styles.project, selected && styles.projectSelected]}>
      <Pressable
        accessibilityLabel={projectLabel(project)}
        accessibilityRole="checkbox"
        accessibilityState={{
          busy: saving,
          checked: selected,
          disabled: saving,
        }}
        android_ripple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined}
        disabled={saving}
        onPress={() => onToggle(project.id)}
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
          <View style={styles.projectTitleRow}>
            <ProjectAvatar
              icon={project.icon}
              lineHeight={typography.headline.lineHeight * fontScale}
              name={projectLabel(project)}
            />
            <Text
              dynamicTypeRamp={typeRamp.headline}
              style={[styles.projectTitle, styles.projectTitleText]}
            >
              {projectLabel(project)}
            </Text>
          </View>
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
            disabled={saving || position <= 0}
            label="Earlier"
            onPress={() => onMove(project.id, -1)}
            size="compact"
          />
          <Button
            accessibilityLabel={`Move ${projectLabel(project)} later`}
            disabled={saving || position === followedProjectIds.length - 1}
            label="Later"
            onPress={() => onMove(project.id, 1)}
            size="compact"
          />
        </View>
      ) : null}
    </View>
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
  projectTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: space.sm },
  projectTitleText: { flex: 1, minWidth: 0 },
  state: { gap: space.sm, paddingVertical: space.xl },
  unavailableProject: { ...cardSurface, borderColor: palette.warm, gap: space.sm },
});
