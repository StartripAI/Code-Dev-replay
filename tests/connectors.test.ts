import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createAudit } from "../packages/core/src";
import { getConnector } from "../packages/connectors/src";
import type { ClientKind, ClientPaths } from "../packages/shared-types/src";

function setupTempFixture(name: string): string {
  const root = join(tmpdir(), `wdyd-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function createStateDb(path: string, withComposer = false, withChatIndex = false): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)");

  if (withComposer) {
    db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify({
        allComposers: [
          {
            composerId: "c1",
            createdAt: 1769001000000,
            lastUpdatedAt: 1769002000000,
            unifiedMode: "agent",
            name: "Implement API",
          },
        ],
      }),
    );
  }

  if (withChatIndex) {
    db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)").run(
      "chat.ChatSessionStore.index",
      JSON.stringify({ version: 1, entries: {} }),
    );
  }

  db.close();
}

function createCursorAiDb(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS ai_code_hashes (hash TEXT PRIMARY KEY, source TEXT, conversationId TEXT, timestamp INTEGER, createdAt INTEGER)",
  );
  db.prepare(
    "INSERT OR REPLACE INTO ai_code_hashes (hash, source, conversationId, timestamp, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run("h1", "composer", "conv-1", 1769003000000, 1769003000000);
  db.close();
}

async function runConnector(client: ClientKind, paths: ClientPaths): Promise<number> {
  const connector = getConnector(client);
  const audit = createAudit(client);
  const events = await connector.scan(paths, { audit });
  assert.ok(events.length > 0, `${client} should produce events`);
  return events.length;
}

test("all six connectors parse fixture inputs", async () => {
  const root = setupTempFixture("connectors");
  cpSync("fixtures", root, { recursive: true });

  const cursorState = join(root, "cursor", "workspace", "state.vscdb");
  const cursorAiDb = join(root, "cursor", "ai-code-tracking.db");
  createStateDb(cursorState, true, false);
  createCursorAiDb(cursorAiDb);

  const vscodeState = join(root, "vscode", "state.vscdb");
  createStateDb(vscodeState, false, true);

  const antigravityState = join(root, "antigravity", "state.vscdb");
  createStateDb(antigravityState, false, true);

  const counts = await Promise.all([
    runConnector("claude", {
      client: "claude",
      roots: [join(root, "claude")],
      files: [join(root, "claude", "sample.jsonl")],
      globs: [],
    }),
    runConnector("codex", {
      client: "codex",
      roots: [join(root, "codex")],
      files: [join(root, "codex", "sample.jsonl")],
      globs: [],
    }),
    runConnector("cursor", {
      client: "cursor",
      roots: [join(root, "cursor")],
      files: [
        join(root, "cursor", "history", "abc", "entries.json"),
        cursorState,
        cursorAiDb,
      ],
      globs: [],
    }),
    runConnector("vscode", {
      client: "vscode",
      roots: [join(root, "vscode")],
      files: [join(root, "vscode", "history", "abc", "entries.json"), vscodeState],
      globs: [],
    }),
    runConnector("antigravity", {
      client: "antigravity",
      roots: [join(root, "antigravity")],
      files: [join(root, "antigravity", "history", "abc", "entries.json"), antigravityState],
      globs: [],
    }),
    runConnector("opencode", {
      client: "opencode",
      roots: [join(root, "opencode")],
      files: [
        join(root, "opencode", "sample.jsonl"),
        join(root, "opencode", "sample.json"),
      ],
      globs: [],
    }),
  ]);

  assert.equal(counts.length, 6);
  rmSync(root, { recursive: true, force: true });
});
