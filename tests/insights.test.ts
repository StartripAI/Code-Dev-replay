import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInsights } from "../packages/core/src";
import type { EvidenceItem, MajorEvent, ProjectScope, QueryIntent, TimelineEvent } from "../packages/shared-types/src";

const query: QueryIntent = {
  raw: "昨天我对paper项目做了什么？",
  normalized: "昨天我对paper项目做了什么",
  language: "zh",
  type: "project_activity",
  asksProject: true,
  asksAllProjects: false,
  projectHint: "paper",
  timeRange: {
    start: 0,
    end: 200_000,
    label: "yesterday",
    source: "query",
  },
};

const scope: ProjectScope = {
  mode: "single",
  project: {
    id: "paper-id",
    name: "paper",
    root: "/Users/alfred/projects/paper",
    client: "codex",
    signalScore: 1,
    lastActiveAt: 1,
    sources: ["fixture"],
  },
};

function makeTimeline(texts: string[]): TimelineEvent[] {
  return texts.map((text, idx) => ({
    id: `t-${idx + 1}`,
    client: "codex",
    ts: 1_000 + idx * 10_000,
    label: idx % 2 === 0 ? "user instruction" : "assistant update",
    detail: text,
    actor: idx % 2 === 0 ? "user" : "assistant",
    tags: ["codex", idx % 2 === 0 ? "user_message" : "assistant_message"],
    sourcePath: "/tmp/session.jsonl",
    metadata: {
      projectRoot: "/Users/alfred/projects/paper",
    },
  }));
}

function makeEvidence(items: Array<Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "type" | "ts" | "sourcePath">>): EvidenceItem[] {
  return items.map((item) => ({
    id: item.id,
    client: "codex",
    projectId: "paper-id",
    ts: item.ts,
    type: item.type,
    sourcePath: item.sourcePath,
    summary: item.summary ?? item.type,
    detail: item.detail ?? item.summary ?? item.type,
    confidence: item.confidence ?? 0.9,
    priority: item.priority ?? 5,
    eventId: item.eventId,
    metadata: item.metadata ?? {},
  }));
}

const majorEvents: MajorEvent[] = [
  {
    id: "m-1",
    client: "codex",
    ts: 40_000,
    type: "GOAL",
    title: "GOAL: shipped parser",
    summary: "parser shipped",
    score: 2,
    triggerEventId: "t-4",
    followUpEventIds: [],
    ruleId: "goal-rule",
  },
];

test("analyzeInsights extracts instruction flow and feature polishing repetition", () => {
  const timeline = makeTimeline([
    "请修复 paper parser 的日期解析",
    "收到，先检查 parser",
    "请修复 paper parser 的日期解析",
    "已改一轮，继续验证",
    "请修复 paper parser 的日期解析",
  ]);
  const evidence = makeEvidence([
    {
      id: "ev-u1",
      type: "user_text",
      ts: 1_000,
      sourcePath: "/tmp/session.jsonl",
      detail: "请修复 paper parser 的日期解析",
    },
    {
      id: "ev-f1",
      type: "file_change",
      ts: 6_000,
      sourcePath: "/Users/alfred/projects/paper/src/parser/date.ts",
    },
    {
      id: "ev-f2",
      type: "file_change",
      ts: 26_000,
      sourcePath: "/Users/alfred/projects/paper/src/parser/index.ts",
    },
    {
      id: "ev-r1",
      type: "tool_result",
      ts: 46_000,
      sourcePath: "/tmp/session.jsonl",
      detail: "tests passed",
    },
  ]);

  const insights = analyzeInsights({
    query,
    scope,
    timeline,
    evidence,
    majorEvents,
  });

  assert.equal(insights.instructions.length, 3);
  assert.ok(insights.repetition.length >= 1);
  assert.equal(insights.repetition[0].interpretation, "feature_polish");
  assert.ok(insights.timelineNarrative.length >= 1);
  assert.match(insights.timelineNarrative[0].summary.toLowerCase(), /file changes/);
});

test("analyzeInsights marks exact repeats without progress as stuck issue", () => {
  const timeline = makeTimeline([
    "登录还是报错，修复一下",
    "我在排查",
    "登录还是报错，修复一下",
    "再看一下",
    "登录还是报错，修复一下",
  ]);
  const evidence = makeEvidence([
    {
      id: "ev-u2",
      type: "user_text",
      ts: 1_000,
      sourcePath: "/tmp/session.jsonl",
      detail: "登录还是报错，修复一下",
    },
  ]);

  const insights = analyzeInsights({
    query,
    scope,
    timeline,
    evidence,
    majorEvents: [],
  });

  const exact = insights.repetition.find((item) => item.kind === "exact_repeat");
  assert.ok(exact);
  assert.equal(exact?.interpretation, "stuck_issue");
});

test("analyzeInsights builds before/after deltas from natural language cues", () => {
  const timeline = makeTimeline([
    "把 note raw 的格式从 plain text 改成 structured json",
    "已开始改",
    "继续完善 note raw",
  ]);
  const evidence = makeEvidence([
    {
      id: "ev-u3",
      type: "user_text",
      ts: 1_000,
      sourcePath: "/tmp/session.jsonl",
      detail: "把 note raw 的格式从 plain text 改成 structured json",
    },
    {
      id: "ev-f3",
      type: "file_change",
      ts: 9_000,
      sourcePath: "/Users/alfred/projects/paper/src/note/raw.ts",
    },
    {
      id: "ev-f4",
      type: "file_change",
      ts: 11_000,
      sourcePath: "/Users/alfred/projects/paper/src/note/index.ts",
    },
    {
      id: "ev-a3",
      type: "assistant_text",
      ts: 14_000,
      sourcePath: "/tmp/session.jsonl",
      detail: "updated format from plain text to structured JSON and reran tests",
    },
  ]);

  const insights = analyzeInsights({
    query,
    scope,
    timeline,
    evidence,
    majorEvents: [],
  });

  assert.ok(insights.featureDeltas.length >= 1);
  assert.match(insights.featureDeltas[0].before.toLowerCase(), /plain text/);
  assert.match(insights.featureDeltas[0].after.toLowerCase(), /structured/);
});

test("analyzeInsights unwraps codex json-style user detail", () => {
  const timeline: TimelineEvent[] = [
    {
      id: "json-u-1",
      client: "codex",
      ts: 1_000,
      label: "codex:message:user",
      detail: '[{"type":"input_text","text":"昨天我对paper项目做了什么？"}]',
      actor: "user",
      tags: ["codex", "user_message"],
      sourcePath: "/tmp/session.jsonl",
      metadata: {},
    },
  ];
  const insights = analyzeInsights({
    query,
    scope,
    timeline,
    evidence: [],
    majorEvents: [],
  });

  assert.equal(insights.instructions.length, 1);
  assert.match(insights.instructions[0].text, /paper项目/);
  assert.ok(!insights.instructions[0].text.includes("input_text"));
});
