const builtInPermissionExplanations: Readonly<Record<string, string>> = {
  edit: "Change project files. Edit, write, and patch use this permission.",
  execute: "Use Code Mode. Each nested tool still applies its own permission.",
  external_directory: "Access files outside the current project location.",
  glob: "Search project file paths with the displayed glob pattern.",
  grep: "Search file contents with the displayed regular expression.",
  question: "Ask you a question before continuing.",
  read: "Read the displayed file or directory.",
  shell:
    "Run the displayed raw command with the host user's filesystem, process, and network access.",
  skill: "Load the displayed skill.",
  subagent: "Start the displayed subagent.",
  webfetch: "Fetch the displayed URL.",
  websearch: "Search the web with the displayed query.",
};

export function permissionActionExplanation(action: string) {
  return builtInPermissionExplanations[action];
}
