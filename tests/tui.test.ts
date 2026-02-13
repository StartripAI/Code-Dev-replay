import test from "node:test";
import assert from "node:assert/strict";
import { buildFrameLines } from "../packages/renderer-tui/src";
import type { ExportPayload } from "../packages/shared-types/src";

const payload: ExportPayload = {
  context: {
    runId: "r1",
    client: "codex",
    startedAt: 1,
    endedAt: 3,
    selectedBy: "auto",
    dataRoots: ["/tmp"],
  },
  timeline: [
    {
      id: "t1",
      client: "codex",
      ts: 1,
      label: "start",
      detail: "detail",
      actor: "system",
      tags: ["codex"],
      sourcePath: "/tmp",
      metadata: {},
    },
  ],
  majorEvents: [
    {
      id: "m1",
      client: "codex",
      ts: 1,
      type: "GOAL",
      title: "GOAL: shipped",
      summary: "shipped successfully",
      score: 1,
      triggerEventId: "t1",
      followUpEventIds: [],
      ruleId: "r1",
    },
  ],
  actionChains: [
    {
      id: "ac1",
      majorEventId: "m1",
      summary: "GOAL: start -> shipped",
      confidence: 0.9,
      steps: [],
    },
  ],
  evidence: [
    {
      id: "ev1",
      client: "codex",
      ts: 1,
      type: "assistant_text",
      sourcePath: "/tmp",
      summary: "ship",
      detail: "done",
      confidence: 0.8,
      priority: 4,
      metadata: {},
    },
  ],
  conflicts: [],
  replay: [
    {
      eventId: "m1",
      before: [],
      focus: {
        id: "m1",
        client: "codex",
        ts: 1,
        type: "GOAL",
        title: "GOAL: shipped",
        summary: "shipped successfully",
        score: 1,
        triggerEventId: "t1",
        followUpEventIds: [],
        ruleId: "r1",
      },
      after: [],
    },
  ],
  audit: {
    client: "codex",
    records: [],
  },
};

test("buildFrameLines renders key sections", () => {
  const lines = buildFrameLines({ payload }, 0, "ALL");
  const output = lines.join("\n");
  assert.match(output, /Proofline Arena/);
  assert.match(output, /Event Detail/);
  assert.match(output, /GOAL/);
});
