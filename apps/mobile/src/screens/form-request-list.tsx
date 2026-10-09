import type { FormInfo, LocationRef, OpenCodeClient } from "@opencode2-mobile/opencode-adapter";
import { StyleSheet, View } from "react-native";

import { space } from "../theme";
import { FormRequestCard } from "./form-request-card";
import { formStateQueryKey, useFormInteractions } from "./use-form-interactions";

export function FormRequestList({
  client,
  connectionId,
  formLocations,
  forms,
  focusSingle = false,
  location,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  formLocations?: ReadonlyMap<string, LocationRef>;
  forms: readonly FormInfo[];
  focusSingle?: boolean;
  location: LocationRef | undefined;
}) {
  const interactions = useFormInteractions({
    client,
    connectionId,
    ...(formLocations ? { formLocations } : {}),
    forms,
    location,
  });
  if (interactions.forms.length === 0) return null;

  return (
    <View
      accessibilityLabel={`${interactions.forms.length} pending form ${interactions.forms.length === 1 ? "request" : "requests"}`}
      style={styles.list}
    >
      {interactions.forms.map((form) => (
        <FormRequestCard
          allowFocus={focusSingle && interactions.forms.length === 1}
          busy={interactions.busyFormId === form.id}
          {...(interactions.errorFormId === form.id
            ? { error: "The form response was not accepted. Current state has been reloaded." }
            : {})}
          form={form}
          key={JSON.stringify(
            formStateQueryKey(
              connectionId ?? "unselected",
              formLocations?.get(form.id) ?? location,
              form,
            ),
          )}
          onCancel={() => interactions.cancelForm(form)}
          onSubmit={(answer) => interactions.replyForm(form, answer)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
});
