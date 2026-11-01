import type Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";

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

type FeatherName = ComponentProps<typeof Feather>["name"];

function count(total: number, singular: string, plural: string) {
  return `${total} ${total === 1 ? singular : plural}`;
}

// Plain card headings for built-in actions. Unknown plugin actions return undefined.
const builtInPermissionLabels: Readonly<
  Record<string, { icon: FeatherName; label: (resources: number) => string }>
> = {
  edit: {
    icon: "edit-3",
    label: (total) => (total > 0 ? `Edit ${count(total, "file", "files")}` : "Edit files"),
  },
  execute: { icon: "code", label: () => "Use Code Mode" },
  external_directory: { icon: "folder", label: () => "Access files outside the project" },
  glob: { icon: "search", label: () => "Search file paths" },
  grep: { icon: "search", label: () => "Search file contents" },
  question: { icon: "help-circle", label: () => "Ask a question" },
  read: {
    icon: "file-text",
    label: (total) => (total > 0 ? `Read ${count(total, "file", "files")}` : "Read files"),
  },
  shell: { icon: "terminal", label: () => "Run shell command" },
  skill: { icon: "book-open", label: () => "Load a skill" },
  subagent: { icon: "users", label: () => "Start a subagent" },
  webfetch: {
    icon: "globe",
    label: (total) => (total > 1 ? `Fetch ${count(total, "page", "pages")}` : "Fetch a web page"),
  },
  websearch: { icon: "globe", label: () => "Search the web" },
};

export function permissionActionHeading(action: string, resourceCount: number) {
  const known = builtInPermissionLabels[action];
  return known ? { icon: known.icon, label: known.label(resourceCount) } : undefined;
}
