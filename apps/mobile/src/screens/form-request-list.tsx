import type { FormInfo, LocationRef, OpenCodeClient } from "@opencode2-mobile/opencode-adapter";
import type { ReactNode } from "react";
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
  renderOwner,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  formLocations?: ReadonlyMap<string, LocationRef>;
  forms: readonly FormInfo[];
  focusSingle?: boolean;
  location: LocationRef | undefined;
  // Pooled lists name the project and session that asked, above each card.
  renderOwner?: (sessionID: string) => ReactNode;
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
        <View key={`${form.sessionID}:${form.id}`} style={styles.item}>
          {renderOwner?.(form.sessionID)}
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
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  // The owner line sits close to its own card, like pooled permission cards.
  item: { gap: space.xs },
});
