import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAudit, discoverProjects } from "../packages/core/src";
import type { ClientPaths, RawEvent } from "../packages/shared-types/src";

test("discoverProjects reads workspace.json roots", () => {
  const root = mkdtempSync(join(tmpdir(), "wdyd-projects-"));
  const wsDir = join(root, "workspaceStorage", "abc");
  mkdirSync(wsDir, { recursive: true });
  const wsFile = join(wsDir, "workspace.json");
  writeFileSync(
    wsFile,
    JSON.stringify({
      folder: "file:///Users/alfred/projects/paper",
    }),
    "utf-8",
  );

  const paths: ClientPaths = {
    client: "cursor",
    roots: [root],
    files: [wsFile],
    globs: [],
  };
  const events: RawEvent[] = [];
  const audit = createAudit("cursor");
  const projects = discoverProjects("cursor", paths, events, audit);
  assert.ok(projects.length >= 1);
  assert.equal(projects[0].name, "paper");

  rmSync(root, { recursive: true, force: true });
});

test("discoverProjects accepts Windows-style absolute paths from events", () => {
  const root = mkdtempSync(join(tmpdir(), "wdyd-projects-"));

  const paths: ClientPaths = {
    client: "cursor",
    roots: [root],
    files: [],
    globs: [],
  };
  const events: RawEvent[] = [
    {
      id: "evt-win-1",
      client: "cursor",
      sourcePath: join(root, "history.json"),
      timestamp: Date.now(),
      kind: "history_entry",
      title: "cursor:history",
      content: "entry",
      metadata: {
        cwd: "C:\\Users\\alice\\projects\\paper",
      },
    },
  ];
  const audit = createAudit("cursor");
  const projects = discoverProjects("cursor", paths, events, audit);

  assert.ok(projects.length >= 1);
  assert.equal(projects[0].name.toLowerCase(), "paper");

  rmSync(root, { recursive: true, force: true });
});
