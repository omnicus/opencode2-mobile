import {
  type LocationRef,
  listOpenCodeSessions,
  type OpenCodeClient,
} from "@opencode2-mobile/opencode-adapter";

export async function loadOpenCodeSessionTreeIds(
  client: OpenCodeClient,
  location: LocationRef,
  rootSessionID: string,
  signal: AbortSignal,
) {
  const ids = [rootSessionID];
  const seenIds = new Set(ids);
  for (let parentIndex = 0; parentIndex < ids.length; parentIndex += 1) {
    const parentID = ids[parentIndex];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const response = await listOpenCodeSessions(
        client,
        location,
        {
          ...(cursor ? { cursor } : {}),
          limit: 100,
          order: "desc",
          parentID,
        },
        { signal },
      );
      for (const session of response.data) {
        if (session.parentID !== parentID) throw new Error("MALFORMED_SESSION_CHILD_LIST");
        if (!seenIds.has(session.id)) {
          seenIds.add(session.id);
          ids.push(session.id);
        }
      }
      cursor = response.cursor.next ?? undefined;
      if (cursor && seenCursors.has(cursor)) throw new Error("REPEATED_SESSION_CURSOR");
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
  }
  return ids;
}
