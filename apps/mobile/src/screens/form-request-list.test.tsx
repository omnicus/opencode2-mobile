import { expect, jest, test } from "@jest/globals";
import type { FormInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FormRequestList } from "./form-request-list";
import { useFormInteractions } from "./use-form-interactions";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({}));

jest.mock("./use-form-interactions", () => ({
  ...jest.requireActual<typeof import("./use-form-interactions")>("./use-form-interactions"),
  useFormInteractions: jest.fn(),
}));

const form: FormInfo = {
  id: "frm_one",
  sessionID: "ses_one",
  title: "Choose",
  fields: [{ key: "answer", type: "string", required: true }],
};
const second = { ...form, id: "frm_two", title: "Other" };

test("one focused form falls back inline when another arrives and keeps its draft", () => {
  const replyForm = jest.fn();
  const interactions = {
    forms: [form],
    replyForm,
    cancelForm: jest.fn(),
    busyFormId: undefined,
    errorFormId: undefined,
  };
  jest.mocked(useFormInteractions).mockReturnValue(interactions);
  const props = {
    client: undefined,
    connectionId: "connection",
    location: { directory: "/workspace" },
    focusSingle: true,
  };
  const view = render(<FormRequestList {...props} forms={[form]} />);
  fireEvent.press(screen.getByRole("button", { name: "Review input request" }));
  fireEvent.changeText(screen.getByLabelText("answer"), "Partial answer");
  jest.mocked(useFormInteractions).mockReturnValue({ ...interactions, forms: [form, second] });
  view.rerender(<FormRequestList {...props} forms={[form, second]} />);
  expect(screen.queryByRole("button", { name: "Close Answer request" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review input request" })).toBeNull();
  expect(screen.getAllByLabelText("answer")[0]?.props.value).toBe("Partial answer");
  const submit = screen.getAllByRole("button", { name: "Submit" })[0];
  if (!submit) throw new Error("Missing submit action");
  fireEvent.press(submit);
  expect(replyForm).toHaveBeenCalledWith(form, { answer: "Partial answer" });
});

test("form answers never cross connection or exact location boundaries", () => {
  jest.mocked(useFormInteractions).mockReturnValue({
    forms: [form],
    replyForm: jest.fn(),
    cancelForm: jest.fn(),
    busyFormId: undefined,
    errorFormId: undefined,
  });
  const props = {
    client: undefined,
    connectionId: "connection",
    location: { directory: "/workspace" },
    forms: [form],
  };
  const view = render(<FormRequestList {...props} />);
  fireEvent.changeText(screen.getByLabelText("answer"), "Private answer");
  view.rerender(<FormRequestList {...props} connectionId="other" />);
  expect(screen.getByLabelText("answer").props.value).toBe("");
  fireEvent.changeText(screen.getByLabelText("answer"), "Different answer");
  view.rerender(
    <FormRequestList
      {...props}
      connectionId="other"
      location={{ directory: "/workspace/child" }}
    />,
  );
  expect(screen.getByLabelText("answer").props.value).toBe("");
});
