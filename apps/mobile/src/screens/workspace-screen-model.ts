import type {
  ProjectListOutput,
  SessionInfo,
  SessionsResponse,
} from "@opencode2-mobile/opencode-adapter";

type Project = ProjectListOutput[number];

export function needsComposerDockMeasurement(
  measuredScreenHeight: number | undefined,
  screenHeight: number,
  keyboardVisible: boolean,
) {
  return !keyboardVisible && measuredScreenHeight !== screenHeight;
}

export function getComposerDockKeyboardOffset(
  dockScreenBottom: number,
  keyboardScreenY: number,
  transparentTopInset = 0,
) {
  return Math.max(0, dockScreenBottom - keyboardScreenY - transparentTopInset);
}

export function flattenSessionPages(pages: SessionsResponse[] | undefined) {
  const seen = new Set<string>();
  const sessions: SessionInfo[] = [];
  for (const page of pages ?? []) {
    for (const session of page.data) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      sessions.push(session);
    }
  }
  return sessions;
}

export function projectDirectories(
  project: Project | undefined,
  defaultProjectId?: string,
  defaultDirectory?: string,
) {
  if (!project) return [];
  return [
    ...new Set([
      project.canonical,
      ...(project.id === defaultProjectId && defaultDirectory ? [defaultDirectory] : []),
      ...project.sandboxes,
    ]),
  ];
}
