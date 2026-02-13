import test from "node:test";
import assert from "node:assert/strict";
import { assertPathAllowed, createAudit } from "../packages/core/src";

test("assertPathAllowed permits whitelisted path", () => {
  const audit = createAudit("claude");
  assert.doesNotThrow(() => {
    assertPathAllowed("/tmp/wdyd/a.jsonl", ["/tmp/wdyd"], audit, "read");
  });
  assert.equal(audit.records.at(-1)?.allowed, true);
});

test("assertPathAllowed blocks non-whitelisted path", () => {
  const audit = createAudit("claude");
  assert.throws(() => {
    assertPathAllowed("/etc/passwd", ["/tmp/wdyd"], audit, "read");
  });
  assert.equal(audit.records.at(-1)?.allowed, false);
});
