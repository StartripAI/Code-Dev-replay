import type { RawEvent, TimelineEvent } from "../../shared-types/src";

function inferActor(event: RawEvent): TimelineEvent["actor"] {
  const kind = event.kind;
  if (kind === "user_message") return "user";
  if (kind === "assistant_message" || kind === "tool_use") return "assistant";
  return "system";
}

export function normalize(rawEvents: RawEvent[]): TimelineEvent[] {
  const dedup = new Map<string, RawEvent>();
  for (const event of rawEvents) {
    if (!dedup.has(event.id)) {
      dedup.set(event.id, event);
    }
  }

  return [...dedup.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((event) => ({
      id: event.id,
      client: event.client,
      ts: event.timestamp,
      label: event.title,
      detail: event.content,
      actor: inferActor(event),
      tags: [event.client, event.kind],
      sourcePath: event.sourcePath,
      metadata: event.metadata,
    }));
}
