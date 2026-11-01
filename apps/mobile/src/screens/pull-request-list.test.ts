import { expect, jest, test } from "@jest/globals";
import type { GitHubPullRequest } from "@opencode2-mobile/opencode-adapter";

import {
  type PullRequestStatusFilter,
  pullRequestStatusFilters,
} from "../storage/pull-request-filter-repository";
import { matchesStatusFilter, pullRequestListItems } from "./pull-request-list";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({ listGitHubPullRequests: jest.fn() }));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
jest.mock("../state/use-pull-request-filter", () => ({ usePullRequestFilter: jest.fn() }));

const base = { branch: "b", number: 1, title: "t", url: "https://github.com/a/b/pull/1" };
const pullRequests: Record<string, GitHubPullRequest> = {
  approved: { ...base, draft: false, number: 1, reviewDecision: "APPROVED" },
  changes: { ...base, draft: false, number: 2, reviewDecision: "CHANGES_REQUESTED" },
  draft: { ...base, draft: true, number: 3, reviewDecision: "REVIEW_REQUIRED" },
  plain: { ...base, draft: false, number: 4 },
  review: { ...base, draft: false, number: 5, reviewDecision: "REVIEW_REQUIRED" },
};

test.each([
  ["all", [1, 2, 3, 4, 5]],
  ["ready", [1, 2, 4, 5]],
  ["draft", [3]],
  // A draft still waiting on review is a draft, not a review request.
  ["review-required", [5]],
  ["approved", [1]],
  ["changes-requested", [2]],
] satisfies [PullRequestStatusFilter, number[]][])("status %s keeps %j", (status, numbers) => {
  expect(
    Object.values(pullRequests)
      .filter((pullRequest) => matchesStatusFilter(pullRequest, status))
      .map((pullRequest) => pullRequest.number),
  ).toEqual(numbers);
});

test("every stored status has a matcher", () => {
  for (const status of pullRequestStatusFilters) {
    expect(typeof matchesStatusFilter(pullRequests.plain as GitHubPullRequest, status)).toBe(
      "boolean",
    );
  }
});

test("counts reflect the filter and an empty match is told apart from no pull requests", () => {
  const project = { canonical: "/a", id: "p1", sandboxes: [], time: { created: 1 } };
  const empty = { canonical: "/b", id: "p2", sandboxes: [], time: { created: 1 } };
  const result = (list: GitHubPullRequest[]) => ({
    data: { pullRequests: list, status: "listed" as const },
    isError: false,
    isPending: false,
    refetch: () => undefined,
  });
  const items = pullRequestListItems(
    [project, empty] as never,
    [result([pullRequests.plain as GitHubPullRequest]), result([])],
    "draft",
  );
  expect(items.map((item) => (item.type === "state" ? item.state : item.type))).toEqual([
    "project",
    "no-match",
    "project",
    "empty",
  ]);
  expect(items[0]).toMatchObject({ count: 0 });
});
