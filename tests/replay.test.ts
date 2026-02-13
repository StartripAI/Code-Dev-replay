import test from "node:test";
import assert from "node:assert/strict";
import { buildReplaySegments } from "../packages/core/src";
import type { MajorEvent, TimelineEvent } from "../packages/shared-types/src";

const timeline: TimelineEvent[] = Array.from({ length: 12 }, (_, idx) => ({
  id: `e-${idx}`,
  client: "claude",
  ts: idx,
  label: `event ${idx}`,
  detail: `detail ${idx}`,
  actor: "system",
  tags: ["claude"],
  sourcePath: "/tmp",
  metadata: {},
}));

const majors: MajorEvent[] = [
  {
    id: "m1",
    client: "claude",
    ts: 5,
    type: "GOAL",
    title: "goal",
    summary: "goal",
    score: 1,
    triggerEventId: "e-5",
    followUpEventIds: ["e-6", "e-7"],
    ruleId: "r1",
  },
];

test("buildReplaySegments generates before and after slices", () => {
  const replay = buildReplaySegments(timeline, majors, 3, 4);
  assert.equal(replay.length, 1);
  assert.equal(replay[0].before.length, 3);
  assert.equal(replay[0].after.length, 4);
});
