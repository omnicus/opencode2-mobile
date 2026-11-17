import { expect, jest, test } from "@jest/globals";
import { renderHook } from "@testing-library/react-native";

import { useSendHandedOffDraft } from "./use-send-handed-off-draft";

const location = { directory: "/projects/alpha" };

function options(overrides: Partial<Parameters<typeof useSendHandedOffDraft>[0]> = {}) {
  return {
    draft: { draft: "Fix the build", loaded: true, mentions: [] },
    enabled: true,
    execution: {
      commands: [],
      completionLoading: false,
      submit: jest.fn(),
      submitDisabled: false,
    },
    location,
    onSent: jest.fn(),
    ready: true,
    ...overrides,
  };
}

test("sends the handed-over draft once the session can take a prompt", () => {
  const blocked = options({ ready: false });
  const { rerender } = renderHook(
    (props: ReturnType<typeof options>) => useSendHandedOffDraft(props),
    { initialProps: blocked },
  );
  expect(blocked.execution.submit).not.toHaveBeenCalled();

  const ready = { ...blocked, ready: true };
  rerender(ready);
  expect(blocked.execution.submit).toHaveBeenCalledTimes(1);
  expect(blocked.execution.submit).toHaveBeenCalledWith("Fix the build", { type: "prompt" });
  expect(blocked.onSent).toHaveBeenCalledTimes(1);

  // Later renders, such as the composer re-enabling after the send, never send it again.
  rerender({ ...ready, execution: { ...ready.execution, submitDisabled: true } });
  rerender({ ...ready });
  expect(blocked.execution.submit).toHaveBeenCalledTimes(1);
});

test("waits for the draft, the execution state, and the command list", () => {
  for (const blocked of [
    options({ draft: { draft: "Fix the build", loaded: false, mentions: [] } }),
    options({
      execution: {
        commands: [],
        completionLoading: false,
        submit: jest.fn(),
        submitDisabled: true,
      },
    }),
    options({
      execution: {
        commands: [],
        completionLoading: true,
        submit: jest.fn(),
        submitDisabled: false,
      },
    }),
  ]) {
    renderHook(() => useSendHandedOffDraft(blocked));
    expect(blocked.execution.submit).not.toHaveBeenCalled();
    expect(blocked.onSent).not.toHaveBeenCalled();
  }
});

test("does nothing for a session opened without a handed-over draft", () => {
  const plain = options({ enabled: false });
  renderHook(() => useSendHandedOffDraft(plain));
  expect(plain.execution.submit).not.toHaveBeenCalled();
  expect(plain.onSent).not.toHaveBeenCalled();
});

test("clears the hand-over without sending an empty draft", () => {
  const empty = options({ draft: { draft: "  ", loaded: true, mentions: [] } });
  renderHook(() => useSendHandedOffDraft(empty));
  expect(empty.onSent).toHaveBeenCalledTimes(1);
  expect(empty.execution.submit).not.toHaveBeenCalled();
});
