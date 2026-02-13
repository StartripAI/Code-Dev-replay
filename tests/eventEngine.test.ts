import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapRulesFromTimeline, classifyEvents, DEFAULT_RULES } from "../packages/event-engine/src";
import type { TimelineEvent } from "../packages/shared-types/src";

const timeline: TimelineEvent[] = [
  {
    id: "1",
    client: "codex",
    ts: 1,
    label: "setup project skeleton",
    detail: "created scaffold",
    actor: "system",
    tags: ["codex", "system"],
    sourcePath: "/tmp/1",
    metadata: {},
  },
  {
    id: "2",
    client: "codex",
    ts: 2,
    label: "apply_patch success",
    detail: "implemented auth flow",
    actor: "assistant",
    tags: ["codex", "assistant_message"],
    sourcePath: "/tmp/2",
    metadata: {},
  },
  {
    id: "3",
    client: "codex",
    ts: 3,
    label: "test failed",
    detail: "permission denied on db file",
    actor: "system",
    tags: ["codex", "system"],
    sourcePath: "/tmp/3",
    metadata: {},
  },
  {
    id: "4",
    client: "codex",
    ts: 4,
    label: "fixed and shipped",
    detail: "done",
    actor: "assistant",
    tags: ["codex", "assistant_message"],
    sourcePath: "/tmp/4",
    metadata: {},
  },
];

test("classifyEvents is stable and creates follow-up links", async () => {
  const options = {
    rules: DEFAULT_RULES,
    followUpWindow: 10,
    followUpCount: 3,
  };

  const first = await classifyEvents(timeline, options);
  const second = await classifyEvents(timeline, options);

  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.ok(first[0].followUpEventIds.length >= 1);
});

test("bootstrap rules do not force neutral events into high-risk types", async () => {
  const neutralTimeline: TimelineEvent[] = [
    {
      id: "n1",
      client: "codex",
      ts: 1,
      label: "edited file",
      detail: "updated tests",
      actor: "assistant",
      tags: ["codex", "assistant_message"],
      sourcePath: "/tmp/n1",
      metadata: {},
    },
    {
      id: "n2",
      client: "codex",
      ts: 2,
      label: "edited file",
      detail: "updated tests",
      actor: "assistant",
      tags: ["codex", "assistant_message"],
      sourcePath: "/tmp/n2",
      metadata: {},
    },
  ];

  const rules = bootstrapRulesFromTimeline(neutralTimeline);
  const majors = await classifyEvents(neutralTimeline, {
    rules,
    followUpWindow: 10,
    followUpCount: 3,
  });

  assert.equal(majors.length, 0);
});
