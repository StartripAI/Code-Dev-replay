import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectEvidence, createAudit } from "../packages/core/src";
import type { ProjectScope, QueryIntent, TimelineEvent } from "../packages/shared-types/src";

const query: QueryIntent = {
  raw: "what did I do?",
  normalized: "what did i do",
  language: "en",
  type: "generic",
  asksProject: true,
  asksAllProjects: false,
  timeRange: {
    start: 0,
    end: 10_000,
    label: "test_range",
    source: "default",
  },
};

test("collectEvidence does not assign sibling-path events to single-project scope", () => {
  const root = mkdtempSync(join(tmpdir(), "proofline-evidence-"));
  const projectRoot = join(root, "proj");
  const siblingRoot = join(root, "proj2");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(siblingRoot, { recursive: true });

  const scope: ProjectScope = {
    mode: "single",
    project: {
      id: "p1",
      name: "proj",
      root: projectRoot,
      client: "codex",
      signalScore: 1,
      lastActiveAt: Date.now(),
      sources: ["test"],
    },
  };

  const timeline: TimelineEvent[] = [
    {
      id: "evt-1",
      client: "codex",
      ts: 1000,
      label: "assistant note",
      detail: "work happened in sibling project",
      actor: "assistant",
      tags: ["codex", "assistant_message"],
      sourcePath: join(root, "session.jsonl"),
      metadata: {
        cwd: siblingRoot,
      },
    },
  ];

  const evidence = collectEvidence({
    client: "codex",
    query,
    scope,
    range: query.timeRange,
    rawEvents: [],
    timeline,
    audit: createAudit("codex"),
    allowedRoots: [projectRoot, siblingRoot],
  });
  rmSync(root, { recursive: true, force: true });

  const fromTimeline = evidence.find((item) => item.eventId === "evt-1");
  assert.ok(fromTimeline);
  assert.equal(fromTimeline?.projectId, undefined);
});

test("collectEvidence assigns the correct project when roots share a prefix", () => {
  const root = mkdtempSync(join(tmpdir(), "proofline-evidence-"));
  const projectRoot = join(root, "proj");
  const siblingRoot = join(root, "proj2");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(siblingRoot, { recursive: true });

  const scope: ProjectScope = {
    mode: "all",
    projects: [
      {
        id: "p1",
        name: "proj",
        root: projectRoot,
        client: "codex",
        signalScore: 1,
        lastActiveAt: Date.now(),
        sources: ["test"],
      },
      {
        id: "p2",
        name: "proj2",
        root: siblingRoot,
        client: "codex",
        signalScore: 1,
        lastActiveAt: Date.now(),
        sources: ["test"],
      },
    ],
  };

  const timeline: TimelineEvent[] = [
    {
      id: "evt-2",
      client: "codex",
      ts: 1000,
      label: "assistant note",
      detail: "work happened in proj2",
      actor: "assistant",
      tags: ["codex", "assistant_message"],
      sourcePath: join(root, "session.jsonl"),
      metadata: {
        cwd: siblingRoot,
      },
    },
  ];

  const evidence = collectEvidence({
    client: "codex",
    query,
    scope,
    range: query.timeRange,
    rawEvents: [],
    timeline,
    audit: createAudit("codex"),
    allowedRoots: [projectRoot, siblingRoot],
  });
  rmSync(root, { recursive: true, force: true });

  const fromTimeline = evidence.find((item) => item.eventId === "evt-2");
  assert.ok(fromTimeline);
  assert.equal(fromTimeline?.projectId, "p2");
});
