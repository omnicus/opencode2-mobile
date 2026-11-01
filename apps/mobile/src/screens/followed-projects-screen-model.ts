type FollowableProject = { canonical: string; id: string; name?: string };

export function sortProjectIDs(
  projects: readonly FollowableProject[],
  followedProjectIDs: readonly string[],
) {
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
export function orderProjects<Project extends FollowableProject>(
  projects: readonly Project[],
  followedProjectIDs: readonly string[],
  initial: readonly string[],
) {
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

export function toggleFollowedProject(followedProjectIds: readonly string[], projectID: string) {
  return followedProjectIds.includes(projectID)
    ? followedProjectIds.filter((candidate) => candidate !== projectID)
    : [...followedProjectIds, projectID];
}

export function moveFollowedProject(
  followedProjectIds: readonly string[],
  projectID: string,
  offset: -1 | 1,
) {
  const currentIndex = followedProjectIds.indexOf(projectID);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= followedProjectIds.length) return;
  const next = [...followedProjectIds];
  const currentProjectID = next[currentIndex];
  const nextProjectID = next[nextIndex];
  if (!currentProjectID || !nextProjectID) return;
  next[currentIndex] = nextProjectID;
  next[nextIndex] = currentProjectID;
  return next;
}

export function projectLabel(project: FollowableProject) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}
