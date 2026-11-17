import type {
  getDefaultOpenCodeLocation,
  LocationRef,
  ProjectListOutput,
} from "@opencode2-mobile/opencode-adapter";

export type Project = ProjectListOutput[number];
export type DefaultLocation = Awaited<ReturnType<typeof getDefaultOpenCodeLocation>>;
export type LocationChoice = { key: string; label: string; location: LocationRef };
export type ProjectRow = {
  id: string;
  project?: Project;
  title?: string;
  type: "project" | "section";
};
export type ProjectBrowserState = "empty" | "error" | "loading" | "projects";
export type CreateRequest = { project: Project; requested: LocationRef };
export type CreateSessionFailure = "aborted" | "failed" | "project-changed";

export function orderProjects(projects: Project[], followedProjectIds: string[]) {
  const followedOrder = new Map(followedProjectIds.map((projectID, index) => [projectID, index]));
  return projects
    .map((project, serverIndex) => ({ project, serverIndex }))
    .sort((first, second) => {
      const firstPosition = followedOrder.get(first.project.id);
      const secondPosition = followedOrder.get(second.project.id);
      if (firstPosition !== undefined && secondPosition !== undefined) {
        return firstPosition - secondPosition;
      }
      if (firstPosition !== undefined) return -1;
      if (secondPosition !== undefined) return 1;
      return first.serverIndex - second.serverIndex;
    })
    .map(({ project }) => project);
}

export function matchingProjects(projects: Project[], search: string) {
  return search
    ? projects.filter((project) => projectSearchText(project).includes(search))
    : projects;
}

export function projectBrowserState({
  loadFailed,
  loading,
  projectCount,
}: {
  loadFailed: boolean;
  loading: boolean;
  projectCount: number;
}): ProjectBrowserState {
  if (loading) return "loading";
  if (loadFailed) return "error";
  return projectCount === 0 ? "empty" : "projects";
}

export function emptyProjectListCopy(searching: boolean, search: string) {
  return searching
    ? { copy: "Try a project name or path.", title: `No projects match "${search.trim()}"` }
    : { copy: "Browse server projects to start a session.", title: "No followed projects" };
}

export function createSessionFailure(caught: unknown): CreateSessionFailure {
  const message = caught instanceof Error ? caught.message : undefined;
  if (message === "REQUEST_ABORTED") return "aborted";
  return message === "LOCATION_PROJECT_MISMATCH" ? "project-changed" : "failed";
}

export function creatingLocationKey(creating: CreateRequest | undefined, project: Project) {
  return creating?.project.id === project.id ? locationKey(creating.requested) : undefined;
}

export function projectLocations(
  project: Project | undefined,
  defaultLocation: DefaultLocation | undefined,
) {
  if (!project) return [];
  const isDefaultProject = defaultLocation?.project.id === project.id;
  const defaultRef = defaultLocation
    ? {
        directory: defaultLocation.directory,
      }
    : undefined;
  const mainLocation =
    isDefaultProject && defaultRef?.directory === project.canonical
      ? defaultRef
      : { directory: project.canonical };
  const choices: LocationChoice[] = [
    { key: locationKey(mainLocation), label: "Main directory", location: mainLocation },
  ];
  if (isDefaultProject && defaultRef && defaultRef.directory !== project.canonical) {
    choices.push({
      key: locationKey(defaultRef),
      label: "Server's working directory",
      location: defaultRef,
    });
  }
  for (const directory of project.sandboxes) {
    if (choices.some((choice) => choice.location.directory === directory)) continue;
    const location = { directory };
    choices.push({
      key: locationKey(location),
      label: directory.split(/[\\/]/).filter(Boolean).at(-1) || directory,
      location,
    });
  }
  return choices;
}

function locationKey(location: LocationRef) {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`;
}

export function projectRows(
  projects: Project[],
  followed: ReadonlySet<string>,
  showOther: boolean,
) {
  const followedProjects = projects.filter((project) => followed.has(project.id));
  const otherProjects = showOther ? projects.filter((project) => !followed.has(project.id)) : [];
  const rows: ProjectRow[] = [];
  if (followedProjects.length) {
    rows.push({ id: "section-followed", title: "Followed projects", type: "section" });
    rows.push(
      ...followedProjects.map((project) => ({
        id: `project-${project.id}`,
        project,
        type: "project" as const,
      })),
    );
  }
  if (otherProjects.length) {
    rows.push({ id: "section-other", title: "Other projects", type: "section" });
    rows.push(
      ...otherProjects.map((project) => ({
        id: `project-${project.id}`,
        project,
        type: "project" as const,
      })),
    );
  }
  return rows;
}

// The device-local draft for a session that does not exist yet. Server session IDs never take
// this shape, so it cannot collide with a real session's draft.
export const newSessionDraftID = "new-session";

// The rows above the composer: followed projects in their saved order, with a chosen project
// that is not followed yet shown first so the selection is always visible.
export function pickerProjects(
  projects: Project[],
  followedProjectIds: string[],
  chosenProjectID: string | undefined,
) {
  const followed = new Set(followedProjectIds);
  const rows = orderProjects(projects, followedProjectIds).filter((project) =>
    followed.has(project.id),
  );
  const chosen = projects.find((project) => project.id === chosenProjectID);
  return chosen && !followed.has(chosen.id) ? [chosen, ...rows] : rows;
}

// Start where the user last worked, then the first followed project, then the server's own.
export function initialProjectID(
  projects: Project[],
  followedProjectIds: string[],
  lastLocation: LocationRef | undefined,
  defaultLocation: DefaultLocation | undefined,
) {
  const followed = new Set(followedProjectIds);
  const last = lastLocation
    ? projects.find(
        (project) =>
          followed.has(project.id) &&
          (project.canonical === lastLocation.directory ||
            project.sandboxes.includes(lastLocation.directory)),
      )
    : undefined;
  if (last) return last.id;
  const firstFollowed = orderProjects(projects, followedProjectIds).find((project) =>
    followed.has(project.id),
  );
  if (firstFollowed) return firstFollowed.id;
  const serverDefault = projects.find((project) => project.id === defaultLocation?.project.id);
  return (serverDefault ?? projects[0])?.id;
}

// The project's location that matches where the user last worked, or its main directory.
export function initialLocationKey(locations: LocationChoice[], lastLocation?: LocationRef) {
  const match = lastLocation
    ? locations.find((choice) => choice.location.directory === lastLocation.directory)
    : undefined;
  return (match ?? locations[0])?.key;
}

export function projectLabel(project: { canonical: string; id: string; name?: string }) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

function projectSearchText(project: Project) {
  return `${projectLabel(project)}\n${project.canonical}\n${project.sandboxes.join("\n")}\n${project.id}`.toLocaleLowerCase();
}
