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

export function projectLabel(project: { canonical: string; id: string; name?: string }) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

function projectSearchText(project: Project) {
  return `${projectLabel(project)}\n${project.canonical}\n${project.sandboxes.join("\n")}\n${project.id}`.toLocaleLowerCase();
}
