import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../packages/core/src";

test("parseQuery detects yesterday and project hint in Chinese", () => {
  const now = Date.parse("2026-02-13T12:00:00Z");
  const parsed = parseQuery("昨天我对paper项目做了什么？", now);
  assert.equal(parsed.timeRange.label, "yesterday");
  assert.equal(parsed.projectHint, "paper");
  assert.equal(parsed.asksProject, true);
});

test("parseQuery detects last 3 days in English", () => {
  const now = Date.parse("2026-02-13T12:00:00Z");
  const parsed = parseQuery("what did I do in the last 3 days for alpha project", now);
  assert.equal(parsed.timeRange.label, "last_3_days");
  assert.equal(parsed.projectHint, "alpha");
});

test("parseQuery falls back to default 24h", () => {
  const now = Date.parse("2026-02-13T12:00:00Z");
  const parsed = parseQuery("show my summary", now);
  assert.equal(parsed.timeRange.label, "default_last_24h");
});

test("parseQuery treats Chinese plural project query as all-project request", () => {
  const now = Date.parse("2026-02-13T12:00:00Z");
  const parsed = parseQuery("昨天我做了哪些项目？", now);
  assert.equal(parsed.asksAllProjects, true);
});

test("parseQuery extracts project hint from Chinese in-project phrasing", () => {
  const now = Date.parse("2026-02-13T12:00:00Z");
  const parsed = parseQuery("今天我在hopeNote具体改了什么UI？", now);
  assert.equal(parsed.projectHint?.toLowerCase(), "hopenote");
  assert.equal(parsed.asksProject, true);
});
