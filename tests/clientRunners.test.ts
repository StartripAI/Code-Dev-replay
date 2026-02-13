import test from "node:test";
import assert from "node:assert/strict";
import { getRunnerCapability } from "../packages/client-runners/src";

test("runner marks vscode unsupported", () => {
  const cap = getRunnerCapability("vscode");
  assert.equal(cap.supported, false);
  assert.match(cap.reason ?? "", /no stable machine-readable/);
});

test("runner marks antigravity unsupported", () => {
  const cap = getRunnerCapability("antigravity");
  assert.equal(cap.supported, false);
});

