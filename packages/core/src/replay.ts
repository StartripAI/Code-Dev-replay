import type { MajorEvent, ReplaySegment, TimelineEvent } from "../../shared-types/src";

export function buildReplaySegments(
  timeline: TimelineEvent[],
  majorEvents: MajorEvent[],
  beforeCount = 5,
  afterCount = 12,
): ReplaySegment[] {
  const indexById = new Map<string, number>();
  timeline.forEach((event, idx) => indexById.set(event.id, idx));

  return majorEvents.map((major) => {
    const focusIdx = indexById.get(major.triggerEventId) ?? 0;
    const beforeStart = Math.max(0, focusIdx - beforeCount);
    const before = timeline.slice(beforeStart, focusIdx);
    const after = timeline.slice(focusIdx + 1, Math.min(timeline.length, focusIdx + 1 + afterCount));

    return {
      eventId: major.id,
      before,
      focus: major,
      after,
    };
  });
}
