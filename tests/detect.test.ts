import test from "node:test";
import assert from "node:assert/strict";
import { detectClient } from "../packages/core/src";

test("detectClient respects forced client", () => {
  const result = detectClient({ forcedClient: "codex" });
  assert.equal(result.client, "codex");
  assert.equal(result.selectedBy, "flag");
});

test("detectClient detects by env", () => {
  const result = detectClient({ env: { WDYD_CLIENT: "cursor" } as NodeJS.ProcessEnv });
  assert.equal(result.client, "cursor");
  assert.equal(result.selectedBy, "env");
});

test("detectClient reports ambiguity", () => {
  const result = detectClient({
    argv: ["node", "cli", "codex", "cursor"],
    parentCommand: "codex cursor",
    env: {} as NodeJS.ProcessEnv,
    cwd: "/tmp",
  });
  assert.equal(result.client, null);
  assert.ok(result.candidates.length >= 1);
});
